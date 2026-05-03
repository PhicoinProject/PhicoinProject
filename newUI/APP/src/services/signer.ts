import { HDKey } from '@scure/bip32';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { toHex, fromHex } from './crypto';
import { getCoinType } from './HDWallet';
import { rpc } from './rpc';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';

/**
 * Local transaction signing service.
 * Signs transactions in the browser using the HDKey - never sends private keys to backend.
 * Backend RPC only broadcasts the signed transaction via sendrawtransaction.
 */

const SIGHASH_ALL = 0x01;

/** Input to sign */
export interface SignInput {
  txid: string;
  vout: number;
  scriptPubKey: string;
  value: number;
  derivationPath: string;
  sequence?: number;
}

/** Transaction to sign and broadcast */
export interface SignTransactionParams {
  inputs: SignInput[];
  outputs: {
    address: string;
    value: number;
  }[];
  feeRate?: number;
  locktime?: number;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function writeVarInt(value: number): Uint8Array {
  if (value < 0xfd) {
    return new Uint8Array([value]);
  } else if (value <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, value, true);
    return buf;
  } else {
    const buf = new Uint8Array(9);
    buf[0] = 0xfe;
    new DataView(buf.buffer).setUint32(1, value, true);
    return buf;
  }
}

function p2pkhScript(pubKey: Uint8Array): Uint8Array {
  const h = hash160(pubKey);
  const script = new Uint8Array(25);
  script[0] = 0x76;
  script[1] = 0xa9;
  script[2] = 0x14;
  script.set(h, 3);
  script[23] = 0x88;
  script[24] = 0xac;
  return script;
}

function p2pkhScriptSig(signature: Uint8Array, pubKey: Uint8Array): Uint8Array {
  const sigLen = writeVarInt(signature.length + 1);
  const pubLen = writeVarInt(pubKey.length);
  const script = new Uint8Array(
    sigLen.length + signature.length + 1 + pubLen.length + pubKey.length
  );
  let offset = 0;
  script.set(sigLen, offset);
  offset += sigLen.length;
  script.set(signature, offset);
  offset += signature.length;
  script[offset] = SIGHASH_ALL;
  offset++;
  script.set(pubLen, offset);
  offset += pubLen.length;
  script.set(pubKey, offset);
  return script;
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function serializeTransaction(
  inputs: SignInput[],
  outputs: { address: string; value: number }[],
  scriptSigs: Uint8Array[],
  locktime = 0
): Uint8Array {
  const parts: Uint8Array[] = [];

  const version = new Uint8Array(4);
  new DataView(version.buffer).setInt32(0, 2, true);
  parts.push(version);

  parts.push(writeVarInt(inputs.length));

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const txidBytes = fromHex(input.txid.split('').reverse().join(''));
    parts.push(txidBytes);

    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, input.vout, true);
    parts.push(vout);

    const scriptSig = scriptSigs[i] || new Uint8Array(0);
    parts.push(writeVarInt(scriptSig.length));
    parts.push(scriptSig);

    const sequence = new Uint8Array(4);
    new DataView(sequence.buffer).setUint32(0, input.sequence ?? 0xffffffff, true);
    parts.push(sequence);
  }

  parts.push(writeVarInt(outputs.length));

  for (const output of outputs) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setBigInt64(0, BigInt(Math.floor(output.value * 1e8)), true);
    parts.push(value);

    const script = new Uint8Array(25);
    script[0] = 0x76;
    script[1] = 0xa9;
    script[2] = 0x14;
    script[23] = 0x88;
    script[24] = 0xac;
    parts.push(writeVarInt(script.length));
    parts.push(script);
  }

  const locktimeBytes = new Uint8Array(4);
  new DataView(locktimeBytes.buffer).setUint32(0, locktime, true);
  parts.push(locktimeBytes);

  return concatArrays(parts);
}

/**
 * Sign a PHICOIN transaction locally.
 *
 * NOTE: This is a simplified P2PKH implementation. Production should use
 * bitcoinjs-lib Psbt for full PSBT support (SegWit, proper SIGHASH, etc.)
 */
export async function signTransaction(
  params: SignTransactionParams
): Promise<{ rawTx: string; txid: string }> {
  const hdKey = getHDKey();
  if (!hdKey) {
    throw new Error('Wallet not unlocked. HDKey is not available.');
  }

  const { inputs, outputs, feeRate = 1 } = params;

  const totalInputSatoshis = inputs.reduce((sum, i) => sum + Math.floor(i.value * 1e8), 0);
  const estimatedSize = inputs.length * 180 + outputs.length * 34;
  const feeSatoshis = estimatedSize * feeRate;
  const totalOutputSatoshis = outputs.reduce((sum, o) => sum + Math.floor(o.value * 1e8), 0);
  const changeSatoshis = totalInputSatoshis - totalOutputSatoshis - feeSatoshis;

  if (changeSatoshis < 0) {
    throw new Error(
      'Insufficient funds. Fee: ' +
        feeSatoshis / 1e8 +
        ' PHI, Change: ' +
        changeSatoshis / 1e8 +
        ' PHI'
    );
  }

  const scriptSigs: Uint8Array[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];

    const derivedKey = hdKey.derive(input.derivationPath);
    const privateKey = derivedKey.privateKey;
    if (!privateKey) throw new Error('No private key at path ' + input.derivationPath);

    const publicKey = derivedKey.publicKey;
    if (!publicKey) throw new Error('No public key at path ' + input.derivationPath);

    const scriptCode = p2pkhScript(publicKey);

    // Simplified SIGHASH - double SHA256 of scriptCode for P2PKH
    const sighash = sha256(sha256(scriptCode));

    const privateKeyBytes = privateKey.slice(0, 32);
    const derSignature = nobleSecp.signSync(sighash, privateKeyBytes, { der: true });

    const signature = new Uint8Array(derSignature.length);
    signature.set(derSignature);

    scriptSigs.push(p2pkhScriptSig(signature, publicKey));
  }

  const rawTx = serializeTransaction(inputs, outputs, scriptSigs);
  const rawTxHex = toHex(rawTx);

  const txidHash = sha256(sha256(rawTx));
  const txid = toHex(new Uint8Array([...txidHash].reverse()));

  return { rawTx: rawTxHex, txid };
}

/** Sign and broadcast a transaction in one step */
export async function signAndBroadcast(
  params: SignTransactionParams
): Promise<{ txid: string; rawTx: string }> {
  const { rawTx, txid } = await signTransaction(params);
  await rpc.sendRawTransaction(rawTx);
  return { rawTx, txid };
}

/** Get available UTXOs for spending from RPC */
export async function getUTXOsForSigning(): Promise<SignInput[]> {
  const unspent = await rpc.listUnspent(1);
  const hdKey = getHDKey();

  if (!hdKey) {
    throw new Error('Wallet not unlocked');
  }

  const inputs: SignInput[] = [];

  for (const utxo of unspent as Record<string, unknown>[]) {
    inputs.push({
      txid: String(utxo.txid),
      vout: Number(utxo.vout),
      scriptPubKey: String(utxo.scriptPubKey),
      value: Number(utxo.amount),
      derivationPath: `m/0'/${getCoinType('mainnet')}'/0'/0/${Number(utxo.account ?? 0)}`,
      sequence: 0xffffffff,
    });
  }

  return inputs;
}

function getHDKey(): HDKey | null {
  return useWalletHDKeyStore.getState().hdKey;
}
