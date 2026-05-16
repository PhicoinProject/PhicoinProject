/**
 * Transaction signer matching C++ QT wallet signing process.
 * 
 * This module replicates the signing logic from the C++ daemon:
 * - src/wallet/wallet.cpp :: SignTransaction()
 * - src/rpc/rawtransaction.cpp :: signrawtransaction()
 * 
 * The C++ flow:
 * 1. Compute sighash (SignatureHash / TransactionSignatureCreator)
 * 2. Sign with private key (ProduceSignature)
 * 3. Build scriptSig with DER signature + compressed pubkey
 * 
 * All signing is done locally in the browser. Private keys never leave the frontend.
 */

import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';

// @noble/secp256k1 requires hmacSha256Sync to be set for signSync
const hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
(nobleSecp.utils as any).hmacSha256Sync = hmacSha256Sync;

// ============================================================================
// Helpers
// ============================================================================

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToArray(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

function writeVarInt(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const b = new Uint8Array(3); b[0] = 0xfd;
    new DataView(b.buffer).setUint16(1, n, true); return b;
  }
  const b = new Uint8Array(5); b[0] = 0xfe;
  new DataView(b.buffer).setUint32(1, n, true); return b;
}

function readVarInt(bytes: Uint8Array, offset: number): { value: number; size: number } {
  if (bytes[offset] < 0xfd) return { value: bytes[offset], size: 1 };
  if (bytes[offset] === 0xfd) return { value: bytes[offset+1] | (bytes[offset+2] << 8), size: 3 };
  if (bytes[offset] === 0xfe) {
    const value = bytes[offset+1] | (bytes[offset+2] << 8) | (bytes[offset+3] << 16) | (bytes[offset+4] << 24);
    return { value, size: 5 };
  }
  return { value: 0, size: 9 };
}

// ============================================================================
// Transaction parsing
// ============================================================================

interface RawTxInput {
  prevTxId: string;  // 32 bytes, big-endian
  vout: number;
  scriptSig: Uint8Array;
  sequence: number;
}

interface RawTxOutput {
  value: bigint;
  scriptPubKey: Uint8Array;
}

interface ParsedTx {
  version: number;
  inputs: RawTxInput[];
  outputs: RawTxOutput[];
  locktime: number;
}

/**
 * Parse a raw transaction hex into structured data.
 * Used for sighash computation.
 */
export function parseRawTx(rawHex: string): ParsedTx {
  const bytes = hexToArray(rawHex);
  let offset = 0;

  // Version (4 bytes, LE)
  const version = new DataView(bytes.buffer, offset, 4).getInt32(0, true);
  offset += 4;

  // Inputs
  const inLen = readVarInt(bytes, offset);
  offset += inLen.size;
  const inputs: RawTxInput[] = [];
  for (let i = 0; i < inLen.value; i++) {
    const prevTxId = toHex(bytes.slice(offset, offset + 32));
    offset += 32;
    const vout = new DataView(bytes.buffer, offset, 4).getUint32(0, true);
    offset += 4;
    const scriptLen = readVarInt(bytes, offset);
    offset += scriptLen.size;
    const scriptSig = bytes.slice(offset, offset + scriptLen.value);
    offset += scriptLen.value;
    const sequence = new DataView(bytes.buffer, offset, 4).getUint32(0, true);
    offset += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }

  // Outputs
  const outLen = readVarInt(bytes, offset);
  offset += outLen.size;
  const outputs: RawTxOutput[] = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, offset, 8).getBigInt64(0, true);
    offset += 8;
    const scriptLen = readVarInt(bytes, offset);
    offset += scriptLen.size;
    const scriptPubKey = bytes.slice(offset, offset + scriptLen.value);
    offset += scriptLen.value;
    outputs.push({ value, scriptPubKey });
  }

  // Locktime (4 bytes, LE)
  const locktime = new DataView(bytes.buffer, offset, 4).getUint32(0, true);

  return { version, inputs, outputs, locktime };
}

/**
 * Rebuild a raw transaction hex from parsed data.
 */
export function buildRawTxHex(tx: ParsedTx): string {
  const parts: Uint8Array[] = [];

  // Version
  const versionBuf = new Uint8Array(4);
  new DataView(versionBuf.buffer).setInt32(0, tx.version, true);
  parts.push(versionBuf);

  // Inputs
  parts.push(writeVarInt(tx.inputs.length));
  for (const inp of tx.inputs) {
    parts.push(hexToArray(inp.prevTxId));
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);
    parts.push(writeVarInt(inp.scriptSig.length));
    parts.push(inp.scriptSig);
    const seqBuf = new Uint8Array(4);
    new DataView(seqBuf.buffer).setUint32(0, inp.sequence, true);
    parts.push(seqBuf);
  }

  // Outputs
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8);
    new DataView(valBuf.buffer).setBigInt64(0, out.value, true);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }

  // Locktime
  const locktimeBuf = new Uint8Array(4);
  new DataView(locktimeBuf.buffer).setUint32(0, tx.locktime, true);
  parts.push(locktimeBuf);

  return toHex(concatBytes(...parts));
}

// ============================================================================
// Sighash computation - Legacy P2PKH
// ============================================================================

// SIGHASH constants
export const SIGHASH_ALL = 0x01;

/**
 * Compute Legacy P2PKH sighash.
 * 
 * Matches C++ SignatureHash() for P2PKH:
 * - Replace scriptSig of the target input with the scriptPubKey
 * - Clear other inputs' scriptSigs
 * - Serialize with sighash type appended
 * - Double SHA256
 * 
 * @param tx - Parsed transaction
 * @param inputIndex - Which input to compute sighash for
 * @param scriptCode - The scriptPubKey of the input (replaces scriptSig)
 * @param hashType - SIGHASH type (default SIGHASH_ALL)
 */
export function sighashLegacyP2PKH(
  tx: ParsedTx,
  inputIndex: number,
  scriptCode: Uint8Array,
  hashType: number = SIGHASH_ALL
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Version (4 bytes LE)
  const versionBuf = new Uint8Array(4);
  new DataView(versionBuf.buffer).setInt32(0, tx.version, true);
  parts.push(versionBuf);

  // Input count
  parts.push(writeVarInt(tx.inputs.length));

  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    
    // prevTxId is stored in big-endian in raw tx hex
    const prevTxIdBytes = hexToArray(inp.prevTxId);
    parts.push(prevTxIdBytes);
    
    // vout
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);

    if (i === inputIndex) {
      // Replace scriptSig with scriptCode (scriptPubKey)
      parts.push(writeVarInt(scriptCode.length));
      parts.push(scriptCode);
    } else {
      // Empty scriptSig for other inputs
      parts.push(writeVarInt(0));
    }

    // sequence
    const seqBuf = new Uint8Array(4);
    new DataView(seqBuf.buffer).setUint32(0, inp.sequence, true);
    parts.push(seqBuf);
  }

  // Output count
  parts.push(writeVarInt(tx.outputs.length));

  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8);
    new DataView(valBuf.buffer).setBigInt64(0, out.value, true);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }

  // Locktime
  const locktimeBuf = new Uint8Array(4);
  new DataView(locktimeBuf.buffer).setUint32(0, tx.locktime, true);
  parts.push(locktimeBuf);

  // SIGHASH type
  const sighashBuf = new Uint8Array(4);
  new DataView(sighashBuf.buffer).setUint32(0, hashType, true);
  parts.push(sighashBuf);

  const serialized = concatBytes(...parts);
  return sha256(sha256(serialized));
}

// ============================================================================
// ScriptSig construction
// ============================================================================

/**
 * Build P2PKH scriptSig: PUSH(sig + sighash) PUSH(pubkey)
 * 
 * Matches C++ UpdateTransaction which builds:
 * scriptSig << signature << pubkey
 * 
 * where signature is DER-encoded + sighash byte.
 */
export function buildP2PKHScriptSig(
  signature: Uint8Array,  // DER-encoded signature
  sighash: number,         // SIGHASH byte (0x01 = ALL)
  pubkey: Uint8Array       // Compressed public key (33 bytes)
): Uint8Array {
  const parts: Uint8Array[] = [];
  
  // Push signature + sighash byte
  const sigData = new Uint8Array(signature.length + 1);
  sigData.set(signature);
  sigData[signature.length] = sighash;
  parts.push(writeVarInt(sigData.length));
  parts.push(sigData);
  
  // Push compressed pubkey
  parts.push(writeVarInt(pubkey.length));
  parts.push(pubkey);
  
  return concatBytes(...parts);
}

// ============================================================================
// Main signing function
// ============================================================================

interface SigningInput {
  txid: string;           // Transaction ID (big-endian)
  vout: number;
  scriptPubKey: Uint8Array;  // P2PKH scriptPubKey of the UTXO
  privateKey: Uint8Array;    // 32-byte private key
  sighashType?: number;     // SIGHASH type (default ALL)
}

/**
 * Sign a raw transaction locally using @noble/secp256k1.
 * 
 * This replicates the C++ QT wallet signing flow:
 * 1. Parse raw tx hex
 * 2. For each input, compute sighash and sign with private key
 * 3. Build P2PKH scriptSig (PUSH(sig+sighash) PUSH(pubkey))
 * 4. Return signed tx hex
 * 
 * Private keys never leave the browser.
 */
export function signRawTransaction(
  rawTxHex: string,
  inputs: SigningInput[]
): string | null {
  try {
    const tx = parseRawTx(rawTxHex);
    
    if (tx.inputs.length !== inputs.length) {
      return null;
    }

    const signedInputs = tx.inputs.map((inp, i) => {
      const signingInput = inputs[i];
      const scriptPubKey = signingInput.scriptPubKey;
      const privateKey = signingInput.privateKey;
      const sighashType = signingInput.sighashType ?? SIGHASH_ALL;

      // Compute sighash
      const sighash = sighashLegacyP2PKH(tx, i, scriptPubKey, sighashType);

      // Sign with private key
      const sigHex = toHex(sighash);
      const privateKeyHex = toHex(privateKey);
      const sig = nobleSecp.signSync(sigHex, privateKeyHex, { der: true });

      // Get compressed public key
      const pubkey = nobleSecp.getPublicKey(privateKeyHex, true);

      // Build scriptSig
      const scriptSig = buildP2PKHScriptSig(sig, sighashType, pubkey);

      return {
        prevTxId: inp.prevTxId,
        vout: inp.vout,
        scriptSig,
        sequence: inp.sequence,
      };
    });

    // Build signed transaction
    const signedTx: ParsedTx = {
      version: tx.version,
      inputs: signedInputs,
      outputs: tx.outputs,
      locktime: tx.locktime,
    };

    return buildRawTxHex(signedTx);
  } catch (err) {
    console.error('signRawTransaction error:', err);
    return null;
  }
}
