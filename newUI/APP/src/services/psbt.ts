import { HDKey } from '@scure/bip32';
import { bech32 } from '@scure/base';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';
import { toHex, fromHex } from './crypto';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { rpc } from './rpc';

// Initialize noble/secp256k1 for deterministic signing
const hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

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
  /** Enable BIP125 Replace-By-Fee: set nSequence < 0xFFFFFFFE on all inputs */
  replaceable?: boolean;
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
    const txidBytes = fromHex(inputs[i].txid);
    const reversed = new Uint8Array(32);
    for (let j = 0; j < 32; j++) {
      reversed[j] = txidBytes[31 - j];
    }
    parts.push(reversed);

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
 * Compute SIGHASH_ALL for a SegWit input (BIP143).
 * Differences from legacy P2PKH sighash:
 * - scriptCode = OP_0 <hash160> (P2WPKH witness script)
 * - amount (little-endian) is included
 * - sequence fields are zeroed for non-current inputs
 * - nHashOutputs uses SIGHASHAnyOutputs mask
 */
function computeSighashBIP143(
  inputs: PSBTInput[],
  outputs: { value: number; scriptPubKey: Uint8Array }[],
  inputIndex: number,
  scriptCode: Uint8Array,
  amountSat: number,
  sighashFlags: number
): Uint8Array {
  const parts: Uint8Array[] = [];

  const version = new Uint8Array(4);
  new DataView(version.buffer).setInt32(0, 2, true);
  parts.push(version);

  const hashPrevOutputs = sha256(sha256(buildPrevOutputs(inputs)));
  parts.push(hashPrevOutputs);

  const hashSequence = sha256(sha256(buildSequences(inputs, inputIndex)));
  parts.push(hashSequence);

  // Outpoint
  const prevTxid = fromHex(inputs[inputIndex].txid);
  const reversed = new Uint8Array(32);
  for (let j = 0; j < 32; j++) reversed[j] = prevTxid[31 - j];
  parts.push(reversed);

  const prevOutput = new Uint8Array(4);
  new DataView(prevOutput.buffer).setUint32(0, inputs[inputIndex].vout, true);
  parts.push(prevOutput);

  const scriptCodeLen = writeVarInt(scriptCode.length);
  parts.push(scriptCodeLen);
  parts.push(scriptCode);

  const amount = new Uint8Array(8);
  new DataView(amount.buffer).setBigInt64(0, BigInt(amountSat), true);
  parts.push(amount);

  const nSequence = new Uint8Array(4);
  new DataView(nSequence.buffer).setUint32(0, inputs[inputIndex].sequence ?? 0xffffffff, true);
  parts.push(nSequence);

  const hashOutputs = sha256(sha256(buildOutputsSegWit(outputs, sighashFlags)));
  parts.push(hashOutputs);

  const locktime = new Uint8Array(4);
  new DataView(locktime.buffer).setUint32(0, 0, true);
  parts.push(locktime);

  const sighash = new Uint8Array(4);
  new DataView(sighash.buffer).setUint32(0, sighashFlags, true);
  parts.push(sighash);

  const serialized = concatArrays(parts);
  return sha256(sha256(serialized));
}

/** Build prev_outpoint data for hashPrevOutputs */
function buildPrevOutputs(inputs: PSBTInput[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const input of inputs) {
    const txidBytes = fromHex(input.txid);
    const reversed = new Uint8Array(32);
    for (let j = 0; j < 32; j++) reversed[j] = txidBytes[31 - j];
    parts.push(reversed);
    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, input.vout, true);
    parts.push(vout);
  }
  return concatArrays(parts);
}

/**
 * Build sequence data for hashSequence.
 * Zero out sequences for non-current inputs (prevents cross-input malleability).
 */
function buildSequences(inputs: PSBTInput[], currentInput: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const seq = new Uint8Array(4);
    const val = i === currentInput ? (inputs[i].sequence ?? 0xffffffff) : 0;
    new DataView(seq.buffer).setUint32(0, val, true);
    parts.push(seq);
  }
  return concatArrays(parts);
}

/**
 * Build outputs data for hashOutputs.
 * If SIGHASH_ANYONECANPAY is not set, hash all outputs.
 * Otherwise hash none (empty).
 */
function buildOutputsSegWit(
  outputs: { value: number; scriptPubKey: Uint8Array }[],
  sighashFlags: number
): Uint8Array {
  if ((sighashFlags & 0x80) !== 0) {
    return new Uint8Array(0);
  }
  const parts: Uint8Array[] = [];
  for (const out of outputs) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setBigInt64(0, BigInt(out.value), true);
    parts.push(value);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }
  return concatArrays(parts);
}

/**
 * Build, sign, and serialize a transaction with mixed P2PKH and SegWit inputs.
 * Auto-detects input type from scriptPubKey format.
 * Supports P2PKH (P), P2WPKH (PHC1), and P2SH-P2WPKH (H) inputs.
 */
export async function buildP2PKHTx(options: PSBTBuildOptions): Promise<string> {
  const hdKey = getHDKey();
  if (!hdKey) throw new Error('Wallet not unlocked');

  const { inputs, outputs, feeRate = 1, locktime = 0, replaceable = false } = options;

  // Apply RBF sequence: set nSequence = 0xFFFFFFFD (< 0xFFFFFFFE) on all inputs (BIP125)
  const effectiveInputs = inputs.map((inp) => ({
    ...inp,
    sequence: replaceable ? 0xFFFFFFFD : inp.sequence ?? 0xFFFFFFFF,
  }));

  // Calculate total input value in satoshis
  const totalInput = inputs.reduce((s, i) => s + Math.round(i.value * 1e8), 0);

  // Calculate total output value in satoshis
  const totalOutput = outputs.reduce((s, o) => s + Math.round(o.value * 1e8), 0);

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
      value: Math.round(out.value * 1e8),
      scriptPubKey: buildScriptFromAddress(out.address),
    });
  }

  // Determine input types from scriptPubKey
  const inputTypes: ('p2pkh' | 'segwit')[] = effectiveInputs.map((inp) => {
    const spk = inp.scriptPubKey ? inp.scriptPubKey.replace(/[^a-fA-F0-9]/g, '') : '';
    // P2WPKH: 00 <20 bytes> = 0x0014...
    // P2SH-P2WPKH: a9 14 <20 bytes> 87 = 0xa914...87
    if (spk.startsWith('0014') || spk.startsWith('0020')) return 'segwit';
    if (spk.startsWith('a914') && spk.endsWith('87')) return 'segwit';
    return 'p2pkh';
  });

  // Sign each input and build scriptSigs + witness stacks
  const scriptSigs: Uint8Array[] = [];
  const witnessStacks: Uint8Array[][] = [];

  for (let i = 0; i < effectiveInputs.length; i++) {
    const input = effectiveInputs[i];
    const derivedKey = hdKey.derive(input.derivationPath);

    const privateKey = derivedKey.privateKey;
    if (!privateKey) throw new Error('No private key at ' + input.derivationPath);

    const publicKey = derivedKey.publicKey;
    if (!publicKey) throw new Error('No public key at ' + input.derivationPath);

    const compressedKey = publicKey.length === 33 ? publicKey : compressPublicKey(publicKey);

    let sighash: Uint8Array;
    const amountSat = Math.round(input.value * 1e8);

    if (inputTypes[i] === 'segwit') {
      // SegWit: scriptCode = OP_0 <hash160>
      const h160 = hash160(compressedKey);
      const scriptCode = new Uint8Array(22);
      scriptCode[0] = 0x00; // OP_0
      scriptCode.set(h160, 1);

      sighash = computeSighashBIP143(inputs, outputScripts, i, scriptCode, amountSat, SIGHASH_ALL);
    } else {
      // Legacy P2PKH: scriptCode = scriptPubKey
      const scriptCode = p2pkhScriptPubKey(compressedKey);
      sighash = computeSighashP2PKH(inputs, outputScripts, i, scriptCode, SIGHASH_ALL);
    }

    // Sign with secp256k1
    const privateKeyBytes = privateKey.slice(0, 32);
    const derSig = nobleSecp.signSync(sighash, privateKeyBytes, { der: true });

    const sigWithHash = new Uint8Array(derSig.length + 1);
    sigWithHash.set(derSig);
    sigWithHash[derSig.length] = SIGHASH_ALL;

    if (inputTypes[i] === 'segwit') {
      // SegWit: witness stack = [sig+pubKey], empty scriptSig
      scriptSigs.push(new Uint8Array(0));
      witnessStacks.push([sigWithHash, compressedKey]);
    } else {
      // P2PKH: scriptSig = [sig+pubKey], empty witness
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
      witnessStacks.push([]);
    }

    // Zeroize per-input private key material as soon as it is no longer needed
    // (defense-in-depth: minimise how long a derived signing key lives in memory).
    privateKeyBytes.fill(0);
    derivedKey.wipePrivateData();
  }

  // Serialize final transaction (with witness support if any segwit inputs)
  const hasSegwit = inputTypes.some((t) => t === 'segwit');
  return serializeTx(effectiveInputs, outputs, scriptSigs, witnessStacks, locktime, hasSegwit);
}

/** Serialize transaction to hex (with optional SegWit witness data, BIP144) */
function serializeTx(
  inputs: PSBTInput[],
  outputs: PSBTOutput[],
  scriptSigs: Uint8Array[],
  witnessStacks: Uint8Array[][],
  locktime: number,
  hasSegwit: boolean
): string {
  const parts: Uint8Array[] = [];

  // Version
  const version = new Uint8Array(4);
  new DataView(version.buffer).setInt32(0, 2, true);
  parts.push(version);

  // Inputs
  parts.push(writeVarInt(inputs.length));
  for (let i = 0; i < inputs.length; i++) {
    const txidBytes = fromHex(inputs[i].txid);
    const reversed = new Uint8Array(32);
    for (let j = 0; j < 32; j++) reversed[j] = txidBytes[31 - j];
    parts.push(reversed);

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

  // Witness marker + flag (BIP144)
  if (hasSegwit) {
    parts.push(new Uint8Array([0x00])); // witnessMarker
    parts.push(new Uint8Array([0x01])); // witnessFlag
  }

  // Outputs
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setBigInt64(0, BigInt(Math.round(out.value * 1e8)), true);
    parts.push(value);

    const script = buildScriptFromAddress(out.address);
    parts.push(writeVarInt(script.length));
    parts.push(script);
  }

  // Witness stacks (one per input, after all outputs)
  if (hasSegwit) {
    for (let i = 0; i < inputs.length; i++) {
      const stack = witnessStacks[i] || [];
      parts.push(writeVarInt(stack.length));
      for (const item of stack) {
        parts.push(writeVarInt(item.length));
        parts.push(item);
      }
    }
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
    // P2PKH: Base58Check (version 0x38)
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
  try {
    const decoded = bech32.decodeUnsafe(address);
    if (!decoded) throw new Error('Invalid bech32 address');
    if (decoded.prefix !== 'PHC') throw new Error('Unexpected bech32 prefix: ' + decoded.prefix);
    // words is already in 5-bit format, convert to bytes
    const bytes = bech32.fromWords(decoded.words);
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

/**
 * Build a replacement transaction with higher fee (BIP125 RBF).
 * Takes the same inputs as the original tx, same outputs, but with a higher feeRate.
 * The replacement fee must be at least 1.25x the original fee (BIP125 minimum relay increment).
 */
export async function buildRBFReplacement(
  inputs: PSBTInput[],
  outputs: PSBTOutput[],
  newFeeRate: number
): Promise<{ txid: string; rawTx: string }> {
  const options: PSBTBuildOptions = {
    inputs,
    outputs,
    feeRate: newFeeRate,
    replaceable: true,
  };

  const rawTx = await buildP2PKHTx(options);
  const txidHash = sha256(sha256(fromHex(rawTx)));
  const txid = toHex(new Uint8Array([...txidHash].reverse()));
  return { txid, rawTx };
}

/** Get HDKey from store */
function getHDKey(): HDKey | null {
  return useWalletHDKeyStore.getState().hdKey;
}
