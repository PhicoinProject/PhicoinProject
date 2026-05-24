import { base58 } from '@scure/base';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { rpc } from './rpc';
import { walletService } from './wallet';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { receivePath, changePath, getCoinType } from './HDWallet';
import {
  buildAssetScript,
  encodeAssetPushData,
  serializeCNewAsset,
  serializeCAssetTransfer,
  serializeCReissueAsset,
  serializeCNullAssetTxData,
  serializeCNullAssetTxVerifierString,
  buildOwnerOutputScript,
  buildVerifierOutputScript,
  toSatoshis,
  buildRawTransaction,
  RestrictedType,
  QualifierType,
  AssetType,
  OWNER_ASSET_AMOUNT,
  MAGIC_NEW_ASSET,
  MAGIC_ASSET_TRANSFER,
  MAGIC_REISSUE_ASSET,
} from './assetSerialization';
import { signRawTransaction } from './txSigner';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { NETWORK } from '@/utils/constants';
import type { Asset, UTXO } from '@/types';

// Initialize noble/secp256k1 for deterministic signing
const hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

const OP_DUP = 0x76;
const OP_HASH160 = 0xa9;
const OP_PUSH_20 = 0x14;
const OP_EQUALVERIFY = 0x88;
const OP_CHECKSIG = 0xac;

/**
 * Build P2PKH scriptPubKey hex from a PHICOIN address locally.
 * Decodes Base58Check to get hash160, then builds the script.
 */
function buildP2PKHScriptPubKeyHex(address: string): string {
  const decoded = base58.decode(address);
  if (decoded.length < 25) throw new Error('Invalid PHICOIN address');
  const checksum = decoded.slice(-4);
  const payload = decoded.slice(0, -4);

  // Verify checksum
  const h1 = sha256(payload);
  const h2 = sha256(h1);
  if (
    h2[0] !== checksum[0] ||
    h2[1] !== checksum[1] ||
    h2[2] !== checksum[2] ||
    h2[3] !== checksum[3]
  ) {
    throw new Error('Invalid address checksum');
  }

  const h160 = payload.slice(1, 21);
  const spk = buildP2PKHScriptPubKeyBytes(h160);
  return toHex(spk);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToArray(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function compressPubKey(pubKey: Uint8Array): Uint8Array {
  if (pubKey.length === 33) return pubKey;
  if (pubKey.length === 65) {
    const parity = pubKey[64] & 1;
    const compressed = new Uint8Array(33);
    compressed[0] = parity === 0 ? 0x02 : 0x03;
    compressed.set(pubKey.slice(1, 33), 1);
    return compressed;
  }
  throw new Error('Invalid public key length');
}

function buildP2PKHScriptPubKeyBytes(h160: Uint8Array): Uint8Array {
  const s = new Uint8Array(25);
  s[0] = OP_DUP;
  s[1] = OP_HASH160;
  s[2] = OP_PUSH_20;
  s.set(h160, 3);
  s[23] = OP_EQUALVERIFY;
  s[24] = OP_CHECKSIG;
  return s;
}

// ---- Asset script parsing helpers ----

interface AssetScriptInfo {
  assetName: string;
  amount: bigint;
}

/**
 * Extract asset name and amount from an asset scriptPubKey hex.
 * Parses the OP_PHI_ASSET (0xc0) payload after the P2PKH prefix (bytes 0-24).
 * Matches C++ IsAssetScript() which checks byte[25] == OP_PHI_ASSET.
 */
function extractAssetScriptInfo(scriptHex: string): AssetScriptInfo | null {
  const clean = scriptHex.startsWith('0x') ? scriptHex.slice(2) : scriptHex;
  const script = hexToArray(clean);
  if (script.length < 31 || script[25] !== 0xc0) return null;

  // Bitcoin SCRIPT pushdata decode (matches C++ src/assets/assets.cpp which
  // checks OP_PUSHDATA1 (0x4c) / OP_PUSHDATA2 (0x4d)), NOT Bitcoin varint:
  //   < 0x4c        -> direct length byte
  //   0x4c (PUSHDATA1) -> next 1 byte is the length
  //   0x4d (PUSHDATA2) -> next 2 bytes little-endian are the length
  let offset = 26;
  let payloadLen = 0;
  const opcode = script[offset];
  if (opcode < 0x4c) {
    payloadLen = opcode;
    offset += 1;
  } else if (opcode === 0x4c) {
    if (offset + 2 > script.length) return null;
    payloadLen = script[offset + 1];
    offset += 2;
  } else if (opcode === 0x4d) {
    if (offset + 3 > script.length) return null;
    payloadLen = script[offset + 1] | (script[offset + 2] << 8);
    offset += 3;
  } else {
    return null;
  }

  if (offset + 4 > script.length) return null;
  // The declared pushdata payload must fit within the remaining script bytes.
  if (payloadLen > 0 && offset + payloadLen > script.length) return null;

  // Check rvn[otpqr] magic (0x72 0x76 0x6e + one of t/q/p/o/r)
  if (!(script[offset] === 0x72 && script[offset + 1] === 0x76 && script[offset + 2] === 0x6e)) return null;
  if (![0x74, 0x71, 0x70, 0x6f, 0x72].includes(script[offset + 3])) return null;

  const dataOffset = offset + 4;
  if (dataOffset + 1 > script.length) return null;

  const nameLen = script[dataOffset];
  if (dataOffset + 1 + nameLen > script.length) return null;
  const assetName = new TextDecoder().decode(script.slice(dataOffset + 1, dataOffset + 1 + nameLen));

  const amountOffset = dataOffset + 1 + nameLen;
  if (amountOffset + 8 > script.length) return null;
  const amount = new DataView(script.buffer, script.byteOffset + amountOffset, 8).getBigInt64(0, true);

  return { assetName, amount };
}

/**
 * Get scriptPubKey hex from a raw UTXO object (handles both string and object formats).
 */
function extractScriptPubKeyHex(obj: Record<string, unknown>): string {
  const spk = obj.scriptPubKey ?? obj.script ?? obj.scriptPubKeyHex ?? '';
  if (typeof spk === 'object' && spk && 'hex' in spk) return String(spk.hex);
  return String(spk);
}

/**
 * Find UTXOs for a specific asset across the wallet's addresses, accumulating
 * until the requested amount (in satoshis) is met. Returns the selected asset
 * inputs and the total amount they hold.
 *
 * Used both for asset transfers and for sourcing the parent owner-token
 * (e.g. "PARENT!") that SUB/UNIQUE/RESTRICTED issuance must spend and re-output.
 */
async function findAssetInputs(
  assetId: string,
  needSat: bigint,
  addresses: string[]
): Promise<{
  inputs: Array<{ txid: string; vout: number; scriptPubKey: string }>;
  total: bigint;
  sourceAddress: string;
}> {
  const inputs: Array<{ txid: string; vout: number; scriptPubKey: string }> = [];
  let total = 0n;
  let sourceAddress = addresses[0] ?? '';

  for (const addr of addresses) {
    try {
      const rawUtxos = await rpc.raw<unknown[]>('getaddressutxos', [{ addresses: [addr], assetName: assetId }]);
      if (!rawUtxos || !Array.isArray(rawUtxos)) continue;

      for (const u of rawUtxos) {
        const obj = u as Record<string, unknown>;
        const spkHex = extractScriptPubKeyHex(obj);
        const info = extractAssetScriptInfo(spkHex);

        if (info && info.assetName === assetId) {
          total += info.amount;
        } else if (info && assetId.endsWith(info.assetName)) {
          total += info.amount;
        } else {
          // Daemon already filtered by assetName; trust its satoshis field.
          total += BigInt(Number(obj.satoshis ?? 0));
        }

        sourceAddress = addr;
        inputs.push({
          txid: String(obj.txid ?? obj.txHash ?? ''),
          vout: Number(obj.vout ?? obj.outputIndex ?? 0),
          scriptPubKey: spkHex,
        });
        if (total >= needSat) break;
      }
    } catch { /* skip addresses with no balance for this asset */ }
    if (total >= needSat) break;
  }

  return { inputs, total, sourceAddress };
}

/**
 * Per-type asset issuance descriptor.
 *
 * Burn amounts/addresses, owner-token rules, magic bytes and output ordering
 * are derived from the C++ reference:
 *   - GetBurnAmount/GetBurnAddress: src/assets/assets.cpp:3701-3764 (all types
 *     are 0.1 COIN to the single mainnet burn address PkC3..., chainparams.cpp:269-291)
 *   - vecSend assembly (burn, owner re-transfer, verifier): CreateAssetTransaction
 *     src/assets/assets.cpp:3954-4055
 *   - appended owner (rvno) + issue (rvnq) outputs: CreateTransactionWithAssets
 *     src/wallet/wallet.cpp:3603-3631 (issue rvnq output is ALWAYS the last vout)
 */
interface IssueDescriptor {
  assetType: number;             // AssetType enum value
  assetName: string;             // Full on-chain name (e.g. PARENT/SUB, PARENT#TAG, #QUAL, $REST)
  quantity: number;              // Amount in satoshis
  decimalPlaces: number;         // units
  reissuable: number;            // 0/1
  hasIPFS: number;               // 0/1
  ipfsHash?: string;
  // Owner-token of the parent asset (e.g. "PARENT!") that must be supplied as
  // an input and re-output to the change address. Required for SUB / UNIQUE /
  // RESTRICTED. Undefined for ROOT / QUALIFIER.
  parentOwnerAsset?: string;
  // Whether this issuance creates its own owner token (rvno) output. True for
  // ROOT and SUB; false for UNIQUE / QUALIFIER / RESTRICTED.
  createsOwnerToken: boolean;
  // Verifier string for RESTRICTED assets (emits a CNullAssetTxVerifierString output).
  verifierString?: string;
}

/**
 * Build and broadcast an asset transaction.
 *
 * Asset issuance (when `issue` is provided) builds the full on-chain structure
 * per asset type. The issue (rvnq) output is always the LAST vout; for SUB the
 * own owner token (rvno) precedes it. Parent owner-token inputs are appended to
 * the input set and their value re-output to the sender for SUB/UNIQUE/RESTRICTED.
 *
 * For other asset operations (transfer, reissue, etc.), simpler tx structures are used.
 *
 * For transfers, assetUtxos must be passed as inputs along with the transfer output.
 */
async function buildAndBroadcastAssetTx(params: {
  assetScriptHex?: string;  // Pre-built asset script for non-issuance ops
  senderAddress: string;
  feeRate?: number;

  // Generalized issuance descriptor (overrides assetScriptHex)
  issue?: IssueDescriptor;

  // Transfer/reissue params
  phiOutput?: { address: string; valueSatoshis: number };
  transferOutput?: boolean; // If true, output value is 0 instead of 1000

  // Asset transfer: UTXOs that are asset inputs (for transfers, reissues, etc.)
  assetInputs?: Array<{
    txid: string;
    vout: number;
    scriptPubKey: string;
  }>;

  // Extra outputs to append (e.g., asset change)
  extraOutputs?: Array<{ scriptPubKey: string; valueSatoshis: number }>;
}): Promise<string> {
  // Use daemon's listunspent (reliable, unlike getaddressutxos)
  const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
  const utxos = (await walletService.getUnspent(addresses)) as UTXO[];

  if (!utxos.length) {
    throw new Error('No UTXOs available for transaction');
  }

  // Get HD key for signing
  const hdKey = useWalletHDKeyStore.getState().hdKey;
  if (!hdKey) {
    throw new Error('Wallet not loaded');
  }

  const changeScript = buildP2PKHScriptPubKeyHex(params.senderAddress);
  const coinType = getCoinType('mainnet');

  // Select PHI UTXOs for fees (pick largest first)
  const sortedUtxos = [...utxos].sort((a, b) => b.amount - a.amount);
  let totalInputSat = 0;
  const selectedUtxos: UTXO[] = [];

  // All asset-issuance types burn 0.1 COIN to the single mainnet burn address.
  // GetBurnAmount() returns 0.1 * COIN for every issuance type
  // (src/assets/assets.cpp:3701-3729, chainparams.cpp:269-291).
  const burnAmount = params.issue ? Math.floor(0.1 * 1e8) : 0;

  // Size-based fee so the tx always clears PHICOIN's relay floor (0.01 PHI/kB =
  // 1000 sat/byte). A flat fee under-pays for larger asset txs (e.g. a SUB issuance with
  // a parent owner-token input + extra outputs), which the daemon rejects with
  // "min relay fee not met". Estimate generously (asset-script outputs are large).
  const numAssetInputs = params.assetInputs?.length ?? 0;
  let estOutputs = 1; // change
  if (params.issue) {
    estOutputs += 2; // burn + issue (rvnq)
    if (params.issue.parentOwnerAsset) estOutputs += 1; // parent owner re-transfer
    if (params.issue.assetType === AssetType.RESTRICTED) estOutputs += 1; // verifier
    if (params.issue.createsOwnerToken) estOutputs += 1; // own owner (rvno)
  } else {
    estOutputs += 1; // asset transfer / reissue output
  }
  const estInputs = 3 + numAssetInputs; // generous PHI-input estimate + asset inputs
  const RELAY_SAT_PER_BYTE = 1000; // 0.01 PHI/kB relay floor
  const estSize = estInputs * 148 + estOutputs * 120 + 50;
  const feeSat = Math.max(500000, estSize * RELAY_SAT_PER_BYTE);

  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo);
    totalInputSat += Math.floor(utxo.amount * 1e8);
    if (totalInputSat > feeSat + burnAmount + 546) break;
  }

  const changeValue = totalInputSat - feeSat - burnAmount;

  // Build outputs based on transaction type
  const outputs: Array<{ scriptPubKey: string; valueSatoshis: number }> = [];

  if (params.issue) {
    // ---- Generalized asset issuance ----
    // Output ordering mirrors the C++ vecSend assembly (burn, parent-owner
    // re-transfer, verifier) followed by the wallet-appended (owner rvno, issue
    // rvnq) outputs, with the rvnq issue output ALWAYS last. Change is placed
    // up front (the C++ change index is randomized; position is not consensus-
    // critical). See CreateAssetTransaction (assets.cpp:3954-4055) and
    // CreateTransactionWithAssets (wallet.cpp:3603-3631).
    const { assetName, quantity, decimalPlaces, reissuable, hasIPFS, ipfsHash } = params.issue;

    // 1. Burn output (0.1 COIN -> mainnet burn address). vecSend[0] in C++.
    outputs.push({
      scriptPubKey: NETWORK.assetBurnScriptPubKey,
      valueSatoshis: burnAmount,
    });

    // 2. Parent owner-token re-transfer back to the issuer (SUB/UNIQUE/RESTRICTED).
    //    C++ pushes a CAssetTransfer(parentOwner!, OWNER_ASSET_AMOUNT) to the
    //    change address (assets.cpp:3983-3991 for SUB/UNIQUE, 4024-4040 for
    //    RESTRICTED). The matching parent owner-token UTXO is added as an input
    //    by the caller via params.assetInputs.
    if (params.issue.parentOwnerAsset) {
      const ownerTransfer = serializeCAssetTransfer({
        name: params.issue.parentOwnerAsset,
        amount: OWNER_ASSET_AMOUNT,
        message: '',
      });
      const ownerTransferPayload = new Uint8Array(4 + ownerTransfer.length);
      ownerTransferPayload.set(MAGIC_ASSET_TRANSFER, 0);
      ownerTransferPayload.set(ownerTransfer, 4);
      const ownerTransferScript = changeScript + 'c0' + encodeAssetPushData(ownerTransferPayload) + '61';
      outputs.push({ scriptPubKey: ownerTransferScript, valueSatoshis: 0 });
    }

    // 3. Verifier output for RESTRICTED assets (CNullAssetTxVerifierString).
    //    C++ appends this after the owner re-transfer (assets.cpp:4048-4054).
    if (params.issue.assetType === AssetType.RESTRICTED) {
      const verifierScript = buildVerifierOutputScript(params.issue.verifierString ?? '');
      outputs.push({ scriptPubKey: verifierScript, valueSatoshis: 0 });
    }

    // 4. Change output. (Position not consensus-critical; see note above.)
    if (changeValue > 546) {
      outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
    }

    // 5. Own owner-token output (rvno) — ROOT and SUB only. Not created for
    //    UNIQUE / QUALIFIER / RESTRICTED (wallet.cpp:3608 excludes those types).
    //    NOTE: the owner payload is exactly { 'rvno' + varString(name + "!") }
    //    per CNewAsset::ConstructOwnerTransaction (assets.cpp:564-577) — it does
    //    NOT contain an 8-byte amount. (The previous ROOT-only inline code wrote
    //    a trailing 8-byte amount that the daemon tolerated but never emits; this
    //    now matches the daemon's serialization byte-for-byte.)
    if (params.issue.createsOwnerToken) {
      const ownerScriptWithP2PKH = buildOwnerOutputScript(changeScript, assetName);
      outputs.push({ scriptPubKey: ownerScriptWithP2PKH, valueSatoshis: 0 });
    }

    // 6. Issue Asset output (rvnq) — ALWAYS the last vout (assets.cpp:586 reads
    //    tx.vout[vout.size()-1] when parsing the new asset).
    const assetData = serializeCNewAsset({
      name: assetName,
      amount: quantity,
      units: decimalPlaces,
      reissuable,
      hasIPFS,
      ipfsHash,
    });
    const issuePayload = new Uint8Array(4 + assetData.length);
    issuePayload.set(MAGIC_NEW_ASSET, 0);
    issuePayload.set(assetData, 4);
    const issueScriptWithP2PKH = changeScript + 'c0' + encodeAssetPushData(issuePayload) + '61';
    outputs.push({ scriptPubKey: issueScriptWithP2PKH, valueSatoshis: 0 });
  } else if (params.assetScriptHex) {
    // Transfer / Reissue / other asset ops
    outputs.push({ scriptPubKey: params.assetScriptHex, valueSatoshis: params.transferOutput ? 0 : 1000 });
    if (changeValue > 546) {
      outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
    }
  }

  // Append extra outputs (asset change, etc.)
  if (params.extraOutputs) {
    outputs.push(...params.extraOutputs);
  }

  // Build all inputs: PHI fee inputs first, then asset inputs
  const allInputs: Array<{ txid: string; vout: number; scriptPubKey: string }> = [];
  allInputs.push(...selectedUtxos.map((u) => ({ txid: u.txid, vout: u.vout, scriptPubKey: String(u.scriptPubKey ?? '') })));
  if (params.assetInputs) {
    allInputs.push(...params.assetInputs);
  }

  // Build raw transaction
  const rawTxHex = await buildRawTransaction(allInputs, outputs);

  // Verify
  const decoded = await rpc.raw<unknown>('decoderawtransaction', [rawTxHex]);
  if (!decoded || !('txid' in (decoded as Record<string, unknown>))) {
    throw new Error('Transaction hex is malformed (decoder returned no txid)');
  }

  // Sign all inputs locally with @noble/secp256k1 — private keys never leave the browser
  // Both PHI and asset inputs use P2PKH sighash (extract hash160 from scriptPubKey)
  const signingInputs: Array<{
    txid: string;
    vout: number;
    scriptPubKey: Uint8Array;
    privateKey: Uint8Array;
  }> = [];

  for (const inp of allInputs) {
    const scriptPubKeyHex = inp.scriptPubKey.startsWith('0x') ? inp.scriptPubKey.slice(2) : inp.scriptPubKey;
    const scriptBytes = hexToArray(scriptPubKeyHex);

    // Asset scripts: P2PKH prefix is bytes 0-24 (hash160 at bytes 3-22)
    const targetH160 = scriptBytes.slice(3, 23);

    let foundPk: Uint8Array | null = null;
    for (let change = 0; change <= 1; change++) {
      for (let index = 0; index < 50; index++) {
        try {
          const path = change === 0
            ? receivePath(coinType, index)
            : changePath(coinType, index);
          const derived = hdKey.derive(path);
          const pk = derived.privateKey;
          const pubKey = derived.publicKey;
          if (!pk || !pubKey) continue;

          const compressedPubKey = pubKey.length === 33 ? pubKey : compressPubKey(pubKey);
          const h160 = hash160(compressedPubKey);
          if (arraysEqual(h160, targetH160)) {
            foundPk = pk;
            break;
          }
        } catch { /* skip */ }
      }
      if (foundPk) break;
    }

    if (!foundPk) {
      throw new Error(`Signing failed: UTXO ${inp.txid}:${inp.vout} does not belong to this wallet`);
    }

    signingInputs.push({
      txid: inp.txid,
      vout: inp.vout,
      scriptPubKey: scriptBytes,
      privateKey: foundPk,
    });
  }

  const signedHex = signRawTransaction(rawTxHex, signingInputs);
  if (!signedHex) {
    throw new Error('Transaction signing failed');
  }

  // Broadcast
  try {
    const mempoolResult = await rpc.testMempoolAccept(signedHex);
    if (mempoolResult && Array.isArray(mempoolResult) && mempoolResult.length > 0) {
      const first = mempoolResult[0] as Record<string, unknown>;
      if (first.allowed !== true && (first.allowed as unknown) !== 1) {
        const rejectReason = String(first['reject-reason'] ?? first.reason ?? 'unknown');
        if (rejectReason !== 'missing-inputs') {
          throw new Error('Transaction rejected by mempool: ' + rejectReason);
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Transaction rejected')) throw err;
    console.warn('testmempoolaccept skipped:', err);
  }

  return rpc.sendRawTransaction(signedHex, true);
}

// ============================================================================

/** Service for PHICOIN native asset protocol operations */
export class AssetService {
  /** List all known assets on the blockchain */
  async listAssets(): Promise<Asset[]> {
    const data = await rpc.raw<Record<string, Record<string, unknown>> | null>('listassets', [
      '',
      true,
      1000,
      0,
    ]);
    if (!data) return [];
    return Object.entries(data).map(([assetName, info]) => ({
      assetId: String(info.name ?? assetName),
      assetLabel: String(info.name ?? assetName),
      status: 'ISSUED',
      assetTx: String(info.blockhash ?? ''),
      nonce: Number(info.block_height ?? 0),
      precision: Number(info.units ?? 8),
      previousAmount: Number(info.amount ?? 0),
      previousTransactions: 0,
      ipfsHash: info.ipfs_hash ? String(info.ipfs_hash) : undefined,
    }));
  }

  /**
   * List assets held by the given address(es).
   * Uses listassetbalancesbyaddress (chain query, no wallet.dat needed).
   */
  async listMyAssets(addresses: string[]): Promise<Asset[]> {
    const assets: Asset[] = [];
    const seen = new Set<string>();

    for (const addr of addresses) {
      try {
        const result = await rpc.raw<Record<string, number>>('listassetbalancesbyaddress', [addr, false, 1000, 0]);
        if (!result || typeof result !== 'object') continue;

        // listassetbalancesbyaddress returns { assetName: balance, "ASSET!": ownerBalance, ... }
        const balances = result as Record<string, number>;
        for (const [assetId, balance] of Object.entries(balances)) {
          const isOwner = assetId.endsWith('!');
          if (seen.has(assetId)) continue;
          seen.add(assetId);

          assets.push({
            assetId,
            assetLabel: isOwner ? assetId.slice(0, -1) : assetId,
            status: 'ISSUED',
            assetTx: '',
            nonce: 0,
            precision: isOwner ? 0 : 8, // Owner assets always have 0 precision
            previousAmount: Number(balance ?? 0),
            previousTransactions: 0,
            ipfsHash: undefined,
            isOwner,
          });
        }
      } catch {
        // Skip addresses with no asset balances
      }
    }

    // Fetch details for each asset to fill precision and ipfsHash
    for (const asset of assets) {
      try {
        const data = await rpc.raw<Record<string, unknown>>('getassetdata', [asset.assetId]);
        if (data) {
          asset.precision = Number(data.units ?? 8);
          if (data.has_ipfs) {
            asset.ipfsHash = String(data.ipfsHash ?? '');
          }
        }
      } catch { /* skip */ }
    }

    return assets;
  }

  /**
   * Get details for a specific asset.
   * Uses getassetdata (chain query, no wallet.dat needed).
   */
  async getAsset(assetId: string): Promise<Asset | null> {
    const data = await rpc.getAsset(assetId);
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    return {
      assetId: String(obj.name ?? assetId),
      assetLabel: String(obj.name ?? assetId),
      status: 'ISSUED',
      assetTx: '',
      nonce: 0,
      precision: Number(obj.units ?? 8),
      previousAmount: Number(obj.amount ?? 0),
      previousTransactions: 0,
      ipfsHash: obj.ipfs_hash ? String(obj.ipfs_hash) : undefined,
    };
  }

  /**
   * Get asset transactions for a given address.
   * Uses z_getaddresstxids with includeAssets flag.
   */
  async getAssetTransactions(address: string, _count = 10, _from = 0): Promise<string[]> {
    return rpc.getAddressTxIds(address);
  }

  /**
   * Get asset UTXOs via getaddressutxos.
   */
  async getAssetUnspent(_assetId: string): Promise<unknown[]> {
    // Asset UTXOs are tracked via UTXO outputs, not wallet-bound.
    return [];
  }

  /**
   * Issue a new asset (ROOT / SUB / UNIQUE / QUALIFIER / RESTRICTED).
   *
   * Detects the asset type from the full name and builds the correct on-chain
   * transaction structure per the C++ reference:
   *   - ROOT/SUB:    burn + own owner token (rvno) + issue (rvnq)
   *   - SUB/UNIQUE:  also spend & re-output the PARENT! owner token
   *   - UNIQUE:      fixed amount=1 COIN, units=0, reissuable=0 (assets.h:37-39),
   *                  no own owner token
   *   - QUALIFIER:   units=0, reissuable=0, no owner token, no parent input
   *                  (rpc/assets.cpp:2434-2435)
   *   - RESTRICTED:  spend & re-output the ROOT! owner token + a verifier output
   *                  (assets.cpp:4024-4054)
   *
   * The asset type is passed explicitly from the form; `label` is the fully
   * composed on-chain name (PARENT/SUB, PARENT#TAG, #QUAL, $REST, or ROOT).
   */
  async issueAsset(params: {
    label: string;
    quantity: number;
    decimalPlaces: number;
    assetType?: number;        // AssetType enum value; defaults to ROOT
    verifierString?: string;   // RESTRICTED only
    isSideChain?: boolean;
    isRevokeable?: boolean;
    isNoAssetGroup?: boolean;
    isIPFS?: boolean;
    ipfsHash?: string;
  }): Promise<string> {
    const { label, quantity, decimalPlaces, isRevokeable, isIPFS, ipfsHash } = params;
    const assetType = params.assetType ?? AssetType.ROOT;

    // Composite names (SUB "PARENT/CHILD", UNIQUE "PARENT#TAG", qualifiers "#X",
    // restricted "$X") can exceed the 31-char ROOT limit; the C++ daemon allows up
    // to 255. Detailed per-type name validation is performed in the form.
    if (!label || label.length < 1 || label.length > 255) {
      throw new Error('Asset name must be 1-255 characters');
    }
    if (quantity <= 0) {
      throw new Error('Quantity must be greater than 0');
    }

    // Per-type CNewAsset field overrides (mirroring the RPC handlers).
    let amountSat: number;
    let units: number;
    let reissuable: number;
    if (assetType === AssetType.UNIQUE) {
      // UNIQUE_ASSET_AMOUNT=1*COIN, UNIQUE_ASSET_UNITS=0, UNIQUE_ASSETS_REISSUABLE=0
      amountSat = OWNER_ASSET_AMOUNT;
      units = 0;
      reissuable = 0;
    } else if (assetType === AssetType.QUALIFIER) {
      // issuequalifierasset forces units=0, reissuable=false (rpc/assets.cpp:2434-2435)
      amountSat = toSatoshis(quantity);
      units = 0;
      reissuable = 0;
    } else {
      amountSat = toSatoshis(quantity);
      units = Math.max(0, Math.min(8, decimalPlaces ?? 8));
      reissuable = isRevokeable ? 1 : 0;
    }
    const hasIPFS = isIPFS ? 1 : 0;

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available. Create or import a wallet first.');
    }

    // Determine parent owner-token requirement and own-owner-token creation.
    let parentOwnerAsset: string | undefined;
    let createsOwnerToken = false;

    if (assetType === AssetType.ROOT) {
      createsOwnerToken = true;
    } else if (assetType === AssetType.SUB) {
      // Parent is the substring before the last "/" — owner token is "PARENT!".
      const parent = label.substring(0, label.lastIndexOf('/'));
      parentOwnerAsset = parent + '!';
      createsOwnerToken = true; // SUB creates its own owner token (wallet.cpp:3608)
    } else if (assetType === AssetType.UNIQUE) {
      // Parent is the substring before the last "#" — owner token is "PARENT!".
      const parent = label.substring(0, label.lastIndexOf('#'));
      parentOwnerAsset = parent + '!';
      createsOwnerToken = false; // UNIQUE creates NO owner token (wallet.cpp:3608)
    } else if (assetType === AssetType.QUALIFIER) {
      createsOwnerToken = false; // no parent input, no owner token
    } else if (assetType === AssetType.RESTRICTED) {
      // "$TOKEN" requires the "TOKEN!" owner token (assets.cpp:4028-4032).
      const stripped = label.startsWith('$') ? label.substring(1) : label;
      parentOwnerAsset = stripped + '!';
      createsOwnerToken = false; // RESTRICTED creates NO owner token (wallet.cpp:3608)
      if (!params.verifierString) {
        throw new Error('A verifier string is required to issue a restricted asset');
      }
    } else {
      throw new Error(`Unsupported asset type for issuance: ${assetType}`);
    }

    // Source the parent owner-token UTXO (1 * COIN) to spend & re-output.
    let assetInputs: Array<{ txid: string; vout: number; scriptPubKey: string }> | undefined;
    let senderAddress = addresses[0];
    if (parentOwnerAsset) {
      const found = await findAssetInputs(parentOwnerAsset, BigInt(OWNER_ASSET_AMOUNT), addresses);
      if (found.total < BigInt(OWNER_ASSET_AMOUNT)) {
        throw new Error(
          `Owner token ${parentOwnerAsset} not found in this wallet. ` +
          `You must hold it to issue this asset.`
        );
      }
      assetInputs = found.inputs;
      // Re-output the parent owner token to the address that held it.
      senderAddress = found.sourceAddress || addresses[0];
    }

    return buildAndBroadcastAssetTx({
      senderAddress,
      assetInputs,
      issue: {
        assetType,
        assetName: label,
        quantity: amountSat,
        decimalPlaces: units,
        reissuable,
        hasIPFS,
        ipfsHash: hasIPFS ? ipfsHash : undefined,
        parentOwnerAsset,
        createsOwnerToken,
        verifierString: params.verifierString,
      },
    });
  }

  /**
   * Transfer an asset to a recipient address.
   *
   * Constructs a raw transaction with CAssetTransfer serialization:
   * recipientP2PKH + OP_PHI_ASSET << rvnt << strName << nAmount << message << OP_DROP
   * Output value: 0 (asset transfers are 0-value outputs)
   */
  async transferAsset(
    assetId: string,
    qty: number,
    toAddress: string,
    message?: string,
    options?: { precision?: number; balance?: number }
  ): Promise<string> {
    if (!assetId) throw new Error('Asset ID is required');
    if (qty <= 0) throw new Error('Quantity must be greater than 0');
    if (!toAddress) throw new Error('Recipient address is required');

    if (options?.balance !== undefined && qty > options.balance) {
      const precision = options.precision ?? 8;
      throw new Error(`Insufficient balance. You have ${options.balance.toFixed(precision)} ${assetId}`);
    }

    const amountSat = toSatoshis(qty);

    const serialized = serializeCAssetTransfer({
      name: assetId,
      amount: amountSat,
      message: message ?? '',
    });

    // Build recipient P2PKH script
    const recipientP2PKH = buildP2PKHScriptPubKeyHex(toAddress);

    // Asset data: rvnt magic + serialized transfer
    const payload = new Uint8Array(4 + serialized.length);
    payload.set(MAGIC_ASSET_TRANSFER, 0);
    payload.set(serialized, 4);

    // Full script: recipientP2PKH + OP_PHI_ASSET + pushdata(payload) + OP_DROP
    const assetScriptHex = recipientP2PKH + 'c0' + encodeAssetPushData(payload) + '61';

    // ---- Find asset UTXOs to use as inputs (Qt wallet approach) ----
    // Step 1: Use listassetbalancesbyaddress to confirm balance per address
    // Step 2: Use getaddressutxos with assetName to get UTXOs

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available. Create or import a wallet first.');
    }

    const { inputs: assetInputs, total: totalAssetBalance, sourceAddress: senderAddress } =
      await findAssetInputs(assetId, BigInt(amountSat), addresses);

    if (totalAssetBalance < BigInt(amountSat)) {
      throw new Error(`Insufficient asset UTXOs for ${assetId}. Need ${amountSat}, have ${totalAssetBalance.toString()}`);
    }

    // ---- Build asset change output if needed ----
    const assetChange = totalAssetBalance - BigInt(amountSat);
    const extraOutputs: Array<{ scriptPubKey: string; valueSatoshis: number }> = [];
    if (assetChange > 0n) {
      const changeScript = buildP2PKHScriptPubKeyHex(senderAddress);
      // Reuse the sender's address P2PKH + OP_PHI_ASSET to create asset change
      const changeSerialized = serializeCAssetTransfer({
        name: assetId,
        amount: Number(assetChange),
        message: '',
      });
      const changePayload = new Uint8Array(4 + changeSerialized.length);
      changePayload.set(MAGIC_ASSET_TRANSFER, 0);
      changePayload.set(changeSerialized, 4);
      const changeAssetScript = changeScript + 'c0' + encodeAssetPushData(changePayload) + '61';
      extraOutputs.push({ scriptPubKey: changeAssetScript, valueSatoshis: 0 });
    }

    // Use all found asset UTXOs as inputs (Qt selects them all, accumulates change)
    const inputsToUse = assetInputs.slice();

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress,
      transferOutput: true,
      assetInputs: inputsToUse,
      extraOutputs,
    });
  }

  /**
   * Reissue an existing asset (increase supply).
   *
   * Constructs a raw transaction with CReissueAsset serialization:
   * OP_PHI_ASSET << strName << nAmount << nUnits << nReissuable << strIPFSHash << OP_DROP
   */
  async reissueAsset(params: {
    name: string;
    quantity: number;
    decimalPlaces?: number;
    reissuable?: boolean;
    ipfsHash?: string;
  }): Promise<string> {
    if (!params.name) throw new Error('Asset name is required');
    if (params.quantity <= 0) throw new Error('Quantity must be greater than 0');

    const amountSat = toSatoshis(params.quantity);

    const serialized = serializeCReissueAsset({
      name: params.name,
      amount: amountSat,
      units: params.decimalPlaces ?? 8,
      reissuable: params.reissuable ? 1 : 0,
      ipfsHash: params.ipfsHash,
    });

    const assetScriptHex = buildAssetScript(serialized, MAGIC_REISSUE_ASSET);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
    });
  }

  /**
   * Assign a qualifier to an address (addtagtoaddress equivalent).
   * Uses CNullAssetTxData with flag for qualifier assignment.
   */
  async assignQualifier(qualifierAsset: string, targetAddress: string): Promise<string> {
    const serialized = serializeCNullAssetTxData({
      assetName: qualifierAsset,
      flag: QualifierType.ADD_QUALIFIER,
    });

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
      phiOutput: { address: targetAddress, valueSatoshis: 1000 },
    });
  }

  /**
   * Remove a qualifier from an address.
   */
  async removeQualifier(qualifierAsset: string, targetAddress: string): Promise<string> {
    const serialized = serializeCNullAssetTxData({
      assetName: qualifierAsset,
      flag: QualifierType.REMOVE_QUALIFIER,
    });

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
      phiOutput: { address: targetAddress, valueSatoshis: 1000 },
    });
  }

  /**
   * Freeze a restricted asset for a specific address.
   */
  async freezeAddress(assetName: string, targetAddress: string): Promise<string> {
    const serialized = serializeCNullAssetTxData({
      assetName,
      flag: RestrictedType.FREEZE_ADDRESS,
    });

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
      phiOutput: { address: targetAddress, valueSatoshis: 1000 },
    });
  }

  /**
   * Unfreeze a restricted asset for a specific address.
   */
  async unfreezeAddress(assetName: string, targetAddress: string): Promise<string> {
    const serialized = serializeCNullAssetTxData({
      assetName,
      flag: RestrictedType.UNFREEZE_ADDRESS,
    });

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
      phiOutput: { address: targetAddress, valueSatoshis: 1000 },
    });
  }

  /**
   * Global freeze of a restricted asset.
   */
  async globalFreeze(assetName: string): Promise<string> {
    const serialized = serializeCNullAssetTxData({
      assetName,
      flag: RestrictedType.GLOBAL_FREEZE,
    });

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
    });
  }

  /**
   * Global unfreeze of a restricted asset.
   */
  async globalUnfreeze(assetName: string): Promise<string> {
    const serialized = serializeCNullAssetTxData({
      assetName,
      flag: RestrictedType.GLOBAL_UNFREEZE,
    });

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
    });
  }

  /**
   * Set a verifier string for a restricted asset.
   */
  async setVerifierString(_assetName: string, verifierString: string): Promise<string> {
    const serialized = serializeCNullAssetTxVerifierString(verifierString);

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
    });
  }

  /**
   * Get asset receive address.
   * Returns the first address from the given pool that holds this asset,
   * or the first address if none found.
   */
  async getAssetAddress(assetId: string, addresses: string[]): Promise<string> {
    const data = await rpc.raw<unknown[]>('listaddressesbyasset', [assetId, false, 1, 0]);
    if (data && Array.isArray(data) && data.length > 0) {
      const addr = data[0] as Record<string, unknown>;
      const foundAddr = String(addr.address ?? '');
      if (foundAddr) return foundAddr;
    }
    return addresses[0] ?? '';
  }
}

export const assetService = new AssetService();
