import { base58 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { rpc } from './rpc';
import { walletService } from './wallet';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import {
  buildAssetScript,
  serializeCNewAsset,
  serializeCAssetTransfer,
  serializeCReissueAsset,
  serializeCNullAssetTxData,
  serializeCNullAssetTxVerifierString,
  buildRawTransaction,
  toSatoshis,
  RestrictedType,
  QualifierType,
} from './assetSerialization';
import type { Asset, UTXO } from '@/types';

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

// Build a lookup map of scriptPubKey → private key for all derived addresses.
// Paths must match the convention in HDWallet.ts: m/0'/coinType'/0'/change/index
async function buildKeyLookupMap(): Promise<Map<string, string>> {
  const hdKey = useWalletHDKeyStore.getState().hdKey;
  if (!hdKey) return new Map();

  const map = new Map<string, string>();
  const coinType = 0; // PHICOIN mainnet
  for (let change = 0; change <= 1; change++) {
    for (let index = 0; index < 50; index++) {
      try {
        const derived = hdKey.derive(`m/0'/${coinType}'/0'/${change}/${index}`);
        const pk = derived.privateKey;
        const pubKey = derived.publicKey;
        if (!pk || !pubKey) continue;

        const compressedPubKey = pubKey.length === 33 ? pubKey : compressPublicKey(pubKey);
        const h160 = hash160(compressedPubKey);
        const spkHex = toHex(buildP2PKHScriptPubKeyBytes(h160));
        map.set(spkHex, toHex(pk));
      } catch {
        // Skip derivation errors
      }
    }
  }
  return map;
}

// ---- Derive private key for a given scriptPubKey ----
async function getPrivateKeyForScript(
  scriptPubKey: string,
  cache?: Map<string, string>
): Promise<string | null> {
  if (cache) {
    return cache.get(scriptPubKey) ?? null;
  }
  const map = await buildKeyLookupMap();
  return map.get(scriptPubKey) ?? null;
}

function compressPublicKey(pubKey: Uint8Array): Uint8Array {
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
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

/**
 * Build a signed asset transaction:
 * 1. Fetch UTXOs for wallet addresses
 * 2. Build raw transaction with asset scriptPubKey output
 * 3. Sign locally with HD-derived private keys
 * 4. Broadcast
 */
async function buildAndBroadcastAssetTx(params: {
  assetScriptHex: string;
  senderAddress: string;
  feeRate?: number;
  phiOutput?: { address: string; valueSatoshis: number };
}): Promise<string> {
  const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
  const utxos = (await walletService.getUnspent(addresses)) as UTXO[];

  if (!utxos.length) {
    throw new Error('No UTXOs available for transaction');
  }

  const feeRate = params.feeRate ?? 1;

  // Calculate total input and determine how many UTXOs we need
  let totalInputSat = 0;
  const selectedUtxos: UTXO[] = [];

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInputSat += Math.floor(utxo.amount * 1e8);

    // Estimate transaction size: ~200 bytes per input, ~40 per output + asset script overhead
    const estimatedSize = selectedUtxos.length * 200 + (params.phiOutput ? 34 : 34) + 100;
    const estimatedFee = estimatedSize * feeRate;
    const minRelayTxFee = 1000;

    const remaining = totalInputSat - estimatedFee - minRelayTxFee;
    if (params.phiOutput && remaining >= params.phiOutput.valueSatoshis) break;
    if (!params.phiOutput && remaining > minRelayTxFee) break;
  }

  const estimatedSize = selectedUtxos.length * 200 + (params.phiOutput ? 34 : 34) + 100;
  const feeSat = Math.max(estimatedSize * feeRate, 1000);

  const outputs: Array<{ scriptPubKey: string; valueSatoshis: number }> = [];

  // Asset output (typically a small PHI amount to the asset script)
  const assetOutputValue = params.phiOutput ? params.phiOutput.valueSatoshis : 1000;
  outputs.push({ scriptPubKey: params.assetScriptHex, valueSatoshis: assetOutputValue });

  // PHI output if specified
  if (params.phiOutput) {
    // Already added above as the asset output phi value
  }

  // Change output
  const totalUsed = assetOutputValue + feeSat;
  if (totalInputSat - totalUsed > 546) {
    const senderScriptPubKey = await buildP2PKHScriptPubKeyHex(params.senderAddress);
    outputs.push({
      scriptPubKey: senderScriptPubKey,
      valueSatoshis: totalInputSat - totalUsed,
    });
  }

  // Build inputs array
  const txInputs = selectedUtxos.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    sequence: 0xffffffff,
  }));

  // Build key lookup map once (batch derivation)
  const keyMap = await buildKeyLookupMap();

  // Create raw transaction
  const rawTxHex = buildRawTransaction(txInputs, outputs);

  // Get previous transactions for signing
  const prevTxs: Record<string, unknown>[] = [];
  for (const u of selectedUtxos) {
    try {
      const prevTx = await rpc.getRawTransaction(u.txid, 1);
      prevTxs.push(prevTx as Record<string, unknown>);
    } catch {
      // Skip if unavailable
    }
  }

  // Collect private keys for all input scriptPubKeys using batch lookup
  const privKeys = new Set<string>();
  for (const u of selectedUtxos) {
    const scriptKey = String(u.scriptPubKey ?? '');
    if (scriptKey) {
      const pk = await getPrivateKeyForScript(scriptKey, keyMap);
      if (pk) privKeys.add(pk);
      else console.warn(`Could not find private key for scriptPubKey: ${scriptKey}`);
    }
  }

  if (privKeys.size === 0) {
    throw new Error(
      'Could not find private keys for any UTXO inputs. ' +
        'Ensure wallet is unlocked and addresses are derived from this wallet.'
    );
  }

  // Sign via RPC signrawtransactionwithkey
  const signResult = await rpc.signRawTransactionWithPrivkeys(rawTxHex, prevTxs, [...privKeys]);
  const signObj = signResult as Record<string, unknown>;

  if (signResult && signObj.complete === true) {
    const hex = String(signObj.hex ?? '');
    if (!hex) throw new Error('Sign successful but no hex returned');
    return rpc.sendRawTransaction(hex, true);
  }

  throw new Error(
    `Transaction signing incomplete. ${
      (signObj.errors as unknown[])?.map((e: unknown) => String(e)).join(', ') ??
      'Unknown signing error'
    }`
  );
}

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
        const balances = await rpc.getAssetBalances(addr);
        for (const entry of (balances || []) as Record<string, unknown>[]) {
          const assetId = String(entry.asset ?? entry.assetId ?? '');
          if (!assetId || seen.has(assetId)) continue;
          seen.add(assetId);

          assets.push({
            assetId,
            assetLabel: assetId,
            status: 'ISSUED',
            assetTx: '',
            nonce: 0,
            precision: Number(entry.precision ?? 8),
            previousAmount: Number(entry.balance ?? entry.amount ?? 0),
            previousTransactions: 0,
            ipfsHash: undefined,
          });
        }
      } catch {
        // Skip addresses with no asset balances
      }
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
   * Issue a new ROOT asset.
   *
   * Constructs a raw transaction with CNewAsset serialization:
   * OP_PHI_ASSET << strName << nAmount << units << nReissuable << nHasIPFS << OP_DROP
   */
  async issueAsset(params: {
    label: string;
    quantity: number;
    decimalPlaces: number;
    isSideChain?: boolean;
    isRevokeable?: boolean;
    isNoAssetGroup?: boolean;
    isIPFS?: boolean;
    ipfsHash?: string;
  }): Promise<string> {
    const { label, quantity, decimalPlaces, isRevokeable, isIPFS, ipfsHash } = params;

    if (!label || label.length > 31) {
      throw new Error('Asset name must be 1-31 characters');
    }
    if (quantity <= 0) {
      throw new Error('Quantity must be greater than 0');
    }

    const amountSat = toSatoshis(quantity);
    const units = Math.max(0, Math.min(8, decimalPlaces ?? 8));
    const reissuable = isRevokeable ? 1 : 0;
    const hasIPFS = isIPFS ? 1 : 0;

    const serialized = serializeCNewAsset({
      name: label,
      amount: amountSat,
      units,
      reissuable,
      hasIPFS,
      ipfsHash: hasIPFS ? ipfsHash : undefined,
    });

    const assetScriptHex = buildAssetScript(serialized);

    // Get first wallet address as sender
    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available. Create or import a wallet first.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
    });
  }

  /**
   * Transfer an asset to a recipient address.
   *
   * Constructs a raw transaction with CAssetTransfer serialization:
   * OP_PHI_ASSET << strName << nAmount << message << OP_DROP
   */
  async transferAsset(
    assetId: string,
    qty: number,
    toAddress: string,
    message?: string
  ): Promise<string> {
    if (!assetId) throw new Error('Asset ID is required');
    if (qty <= 0) throw new Error('Quantity must be greater than 0');
    if (!toAddress) throw new Error('Recipient address is required');

    const amountSat = toSatoshis(qty);

    const serialized = serializeCAssetTransfer({
      name: assetId,
      amount: amountSat,
      message: message ?? '',
    });

    const assetScriptHex = buildAssetScript(serialized);

    // Get first wallet address as sender
    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
    if (!addresses.length) {
      throw new Error('No wallet addresses available. Create or import a wallet first.');
    }

    return buildAndBroadcastAssetTx({
      assetScriptHex,
      senderAddress: addresses[0],
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

    const assetScriptHex = buildAssetScript(serialized);

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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

    const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
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
