import { HDKey } from '@scure/bip32';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { toHex, fromHex } from './crypto';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { rpc } from './rpc';

/**
 * PSBT-like transaction builder and signer using pure @scure libraries.
 * Avoids bitcoinjs-lib initEccLib compatibility issues.
 */

const SIGHASH_ALL = 0x01;

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function writeVarInt(value: number): Uint8Array {
  if (value < 0xfd) return new Uint8Array([value]);
  if (value <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, value, true);
    return buf;
  }
  const buf = new Uint8Array(9);
  buf[0] = 0xfe;
  new DataView(buf.buffer).setUint32(1, value, true);
  return buf;
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function p2pkhScriptPubKey(pubKey: Uint8Array): Uint8Array {
  const h = hash160(pubKey);
  const s = new Uint8Array(25);
  s[0] = 0x76;
  s[1] = 0xa9;
  s[2] = 0x14;
  s.set(h, 3);
  s[23] = 0x88;
  s[24] = 0xac;
  return s;
}

/** P2SH scriptPubKey: OP_HASH160 <hash160> OP_EQUAL */
function p2shScriptPubKey(h160: Uint8Array): Uint8Array {
  const s = new Uint8Array(23);
  s[0] = 0xa9;
  s[1] = 0x14;
  s.set(h160, 2);
  s[22] = 0x87;
  return s;
}

/**
 * Decode a Base58Check PHICOIN address back to hash160.
 */
function decodeBase58Check(address: string): { version: number; hash160: Uint8Array } {
  const decoded = base58Decode(address);
  if (decoded.length < 5) throw new Error('Invalid Base58Check address');
  // verify checksum
  const payload = decoded.slice(0, -4);
  const checksum = decoded.slice(-4);
  const h1 = sha256(payload);
  const h2 = sha256(h1);
  if (
    h2[0] !== checksum[0] ||
    h2[1] !== checksum[1] ||
    h2[2] !== checksum[2] ||
    h2[3] !== checksum[3]
  ) {
    throw new Error('Invalid Base58Check checksum');
  }
  return { version: payload[0], hash160: payload.slice(1) };
}

/** Minimal Base58 decode */
function base58Decode(text: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let decimal = BigInt(0);
  for (const c of text) {
    const i = ALPHABET.indexOf(c);
    if (i === -1) throw new Error('Invalid Base58 character: ' + c);
    decimal = decimal * BigInt(58) + BigInt(i);
  }
  const bytes: number[] = [];
  while (decimal > 0n) {
    bytes.push(Number(decimal % 256n));
    decimal = decimal / 256n;
  }
  for (const c of text) {
    if (c !== '1') break;
    bytes.push(0);
  }
  bytes.reverse();
  return new Uint8Array(bytes);
}

/** PSBT Input */
export interface PSBTInput {
  txid: string;
  vout: number;
  scriptPubKey: string;
  value: number;
  derivationPath: string;
  sequence?: number;
}

/** PSBT Output */
export interface PSBTOutput {
  address: string;
  value: number;
  isChange?: boolean;
}

/** PSBT Build options */
export interface PSBTBuildOptions {
  inputs: PSBTInput[];
  outputs: PSBTOutput[];
  feeRate?: number;
  locktime?: number;
  changeAddress?: string;
  changePath?: string;
}

/**
 * Compute SIGHASH_ALL for a P2PKH input.
 * Uses scriptCode approach: replace scriptSig with scriptPubKey of the output being spent.
 */
function computeSighashP2PKH(
  inputs: PSBTInput[],
  outputs: { value: number; scriptPubKey: Uint8Array }[],
  inputIndex: number,
  scriptCode: Uint8Array,
  sighashFlags: number
): Uint8Array {
  const parts: Uint8Array[] = [];

  const version = new Uint8Array(4);
  new DataView(version.buffer).setInt32(0, 2, true);
  parts.push(version);

  parts.push(writeVarInt(inputs.length));

  for (let i = 0; i < inputs.length; i++) {
    const txidBytes = fromHex(inputs[i].txid.split('').reverse().join(''));
    parts.push(txidBytes);

    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, inputs[i].vout, true);
    parts.push(vout);

    if (i === inputIndex) {
      parts.push(writeVarInt(scriptCode.length));
      parts.push(scriptCode);
    } else {
      parts.push(writeVarInt(0));
    }

    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setUint32(0, inputs[i].sequence ?? 0xffffffff, true);
    parts.push(seq);
  }

  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setBigInt64(0, BigInt(out.value), true);
    parts.push(value);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }

  const locktime = new Uint8Array(4);
  new DataView(locktime.buffer).setUint32(0, 0, true);
  parts.push(locktime);

  const sighash = new Uint8Array(4);
  new DataView(sighash.buffer).setUint32(0, sighashFlags, true);
  parts.push(sighash);

  const serialized = concatArrays(parts);
  return sha256(sha256(serialized));
}

/**
 * Build, sign, and serialize a complete P2PKH transaction.
 * Returns raw transaction hex.
 */
export async function buildP2PKHTx(options: PSBTBuildOptions): Promise<string> {
  const hdKey = getHDKey();
  if (!hdKey) throw new Error('Wallet not unlocked');

  const { inputs, outputs, feeRate = 1, locktime = 0 } = options;

  // Calculate total input value in satoshis
  const totalInput = inputs.reduce((s, i) => s + Math.floor(i.value * 1e8), 0);

  // Calculate total output value in satoshis
  const totalOutput = outputs.reduce((s, o) => s + Math.floor(o.value * 1e8), 0);

  // Estimate transaction size and fee
  const estimatedSize = inputs.length * 180 + outputs.length * 34;
  const fee = estimatedSize * feeRate;
  const change = totalInput - totalOutput - fee;

  if (change < 0) {
    throw new Error('Insufficient funds. Missing: ' + (change / -1e8).toFixed(8) + ' PHI');
  }

  // Build output scripts
  const outputScripts: { value: number; scriptPubKey: Uint8Array }[] = [];
  for (const out of outputs) {
    outputScripts.push({
      value: Math.floor(out.value * 1e8),
      scriptPubKey: buildScriptFromAddress(out.address),
    });
  }

  // Sign each input and build scriptSigs
  const scriptSigs: Uint8Array[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const derivedKey = hdKey.derive(input.derivationPath);

    const privateKey = derivedKey.privateKey;
    if (!privateKey) throw new Error('No private key at ' + input.derivationPath);

    const publicKey = derivedKey.publicKey;
    if (!publicKey) throw new Error('No public key at ' + input.derivationPath);

    const compressedKey = publicKey.length === 33 ? publicKey : compressPublicKey(publicKey);
    const scriptCode = p2pkhScriptPubKey(compressedKey);

    // Compute SIGHASH
    const sighash = computeSighashP2PKH(inputs, outputScripts, i, scriptCode, SIGHASH_ALL);

    // Sign with secp256k1
    const privateKeyBytes = privateKey.slice(0, 32);
    const derSig = nobleSecp.signSync(sighash, privateKeyBytes, { der: true });

    // Build scriptSig: [sigLen][sig+SIGHASH][pubLen][pubKey]
    const sigWithHash = new Uint8Array(derSig.length + 1);
    sigWithHash.set(derSig);
    sigWithHash[derSig.length] = SIGHASH_ALL;

    const sigLen = writeVarInt(sigWithHash.length);
    const pubLen = writeVarInt(compressedKey.length);

    const scriptSig = new Uint8Array(
      sigLen.length + sigWithHash.length + pubLen.length + compressedKey.length
    );
    let off = 0;
    scriptSig.set(sigLen, off);
    off += sigLen.length;
    scriptSig.set(sigWithHash, off);
    off += sigWithHash.length;
    scriptSig.set(pubLen, off);
    off += pubLen.length;
    scriptSig.set(compressedKey, off);

    scriptSigs.push(scriptSig);
  }

  // Serialize final transaction
  return serializeTx(inputs, outputs, scriptSigs, locktime);
}

/** Serialize transaction to hex */
function serializeTx(
  inputs: PSBTInput[],
  outputs: PSBTOutput[],
  scriptSigs: Uint8Array[],
  locktime: number
): string {
  const parts: Uint8Array[] = [];

  // Version
  const version = new Uint8Array(4);
  new DataView(version.buffer).setInt32(0, 2, true);
  parts.push(version);

  // Inputs
  parts.push(writeVarInt(inputs.length));
  for (let i = 0; i < inputs.length; i++) {
    const txidBytes = fromHex(inputs[i].txid.split('').reverse().join(''));
    parts.push(txidBytes);

    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, inputs[i].vout, true);
    parts.push(vout);

    const scriptSig = scriptSigs[i] || new Uint8Array(0);
    parts.push(writeVarInt(scriptSig.length));
    parts.push(scriptSig);

    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setUint32(0, inputs[i].sequence ?? 0xffffffff, true);
    parts.push(seq);
  }

  // Outputs
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setBigInt64(0, BigInt(Math.floor(out.value * 1e8)), true);
    parts.push(value);

    const script = buildScriptFromAddress(out.address);
    parts.push(writeVarInt(script.length));
    parts.push(script);
  }

  // Locktime
  const locktimeBytes = new Uint8Array(4);
  new DataView(locktimeBytes.buffer).setUint32(0, locktime, true);
  parts.push(locktimeBytes);

  const rawTx = concatArrays(parts);
  return toHex(rawTx);
}

/** Build scriptPubKey from a PHICOIN address */
function buildScriptFromAddress(address: string): Uint8Array {
  if (address.startsWith('P')) {
    // P2PKH: version 0x37
    const { hash160 } = decodeBase58Check(address);
    const s = new Uint8Array(25);
    s[0] = 0x76;
    s[1] = 0xa9;
    s[2] = 0x14;
    s.set(hash160, 3);
    s[23] = 0x88;
    s[24] = 0xac;
    return s;
  }
  if (address.startsWith('H')) {
    // P2SH: version 0x3c
    const { hash160 } = decodeBase58Check(address);
    return p2shScriptPubKey(hash160);
  }
  if (address.startsWith('PHC1')) {
    // P2WPKH: bech32 encoded witness program
    const decoded = bech32Decode(address);
    return decoded;
  }
  // Fallback: empty script
  return new Uint8Array(0);
}

/** Decode bech32 PHICOIN SegWit address to witness program */
function bech32Decode(address: string): Uint8Array {
  // Import dynamic to avoid Node issues
  const { bech32 } = require('@scure/base');
  try {
    const { prefix, words } = bech32.decode(address);
    if (prefix !== 'PHC') throw new Error('Unexpected bech32 prefix: ' + prefix);
    // words is already in 5-bit format, convert to bytes
    const bytes = bech32.fromWords(words);
    if (bytes[0] !== 0) throw new Error('Non-version-0 witness');
    const s = new Uint8Array(22);
    s[0] = 0x00;
    s.set(bytes.slice(1), 1);
    return s;
  } catch {
    return new Uint8Array(0);
  }
}

/** Compress public key */
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

/** Broadcast a signed transaction with optional allowHighFees flag */
export async function broadcastTx(rawTxHex: string, allowHighFees = false): Promise<string> {
  return rpc.sendRawTransaction(rawTxHex, allowHighFees);
}

/**
 * Run testmempoolaccept pre-flight validation on a raw transaction.
 * Returns the RPC response; throws on rejection.
 */
export async function testMempoolAccept(rawTxHex: string): Promise<unknown[]> {
  return rpc.testMempoolAccept(rawTxHex);
}

/**
 * Build, sign, and broadcast in one step.
 */
export async function buildAndBroadcast(
  options: PSBTBuildOptions
): Promise<{ txid: string; rawTx: string }> {
  const rawTx = await buildP2PKHTx(options);
  const txidHash = sha256(sha256(fromHex(rawTx)));
  const txid = toHex(new Uint8Array([...txidHash].reverse()));
  await broadcastTx(rawTx);
  return { txid, rawTx };
}

/**
 * Build and sign only -- does NOT broadcast.
 * Returns the raw hex and computed txid for pre-flight checks.
 */
export async function buildAndSignOnly(
  options: PSBTBuildOptions
): Promise<{ txid: string; rawTx: string }> {
  const rawTx = await buildP2PKHTx(options);
  const txidHash = sha256(sha256(fromHex(rawTx)));
  const txid = toHex(new Uint8Array([...txidHash].reverse()));
  return { txid, rawTx };
}

/** Get HDKey from store */
function getHDKey(): HDKey | null {
  return useWalletHDKeyStore.getState().hdKey;
}
