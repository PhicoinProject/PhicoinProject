/**
 * Serialize asset protocol messages to match the C++ format.
 *
 * The C++ serialization uses READWRITE macros where strings are variable-length
 * (1-byte length prefix for < 253 bytes), CAmount is 8-byte LE int64, etc.
 *
 * The C++ ConstructTransaction method wraps serialized data with 4-byte magic
 * prefixes, then pushdata-encodes the result:
 *   script << OP_PHI_ASSET << ToByteVector(magic + serialized) << OP_DROP
 *
 * Magic bytes (from src/assets/assets.h):
 *   PHI_R=114 ('r'), PHI_V=118 ('v'), PHI_N=110 ('n'),
 *   PHI_Q=113 ('q'), PHI_T=116 ('t'), PHI_O=111 ('o')
 *
 * Per-type magic:
 *   CNewAsset:        "rvnq"  (PHI_R, PHI_V, PHI_N, PHI_Q)
 *   CAssetTransfer:   "rvnt"  (PHI_R, PHI_V, PHI_N, PHI_T)
 *   CReissueAsset:    "rvnr"  (PHI_R, PHI_V, PHI_N, PHI_R)
 *   CNullAssetTxData: (no magic, no OP_PHI_ASSET wrapper - raw data only)
 *   CNullAssetTxVerifierString: (no magic, wrapped with OP_PHI_ASSET + OP_RESERVED)
 *
 * Script format:
 *   OP_PHI_ASSET (0xc0) << pushdata_len << [magic][serialized] << OP_DROP (0x61)
 */

const OP_PHI_ASSET = 0xc0;
const OP_DROP = 0x61;
const OP_RESERVED = 0x50;

// Magic byte prefixes matching src/assets/assets.h
export const MAGIC_NEW_ASSET = new Uint8Array([114, 118, 110, 113]); // 'r','v','n','q'
export const MAGIC_ASSET_TRANSFER = new Uint8Array([114, 118, 110, 116]); // 'r','v','n','t'
export const MAGIC_REISSUE_ASSET = new Uint8Array([114, 118, 110, 114]); // 'r','v','n','r'

/** Asset type values matching AssetType enum in assettypes.h */
export const AssetType = {
  ROOT: 0,
  SUB: 1,
  UNIQUE: 2,
  MSGCHANNEL: 3,
  QUALIFIER: 4,
  SUB_QUALIFIER: 5,
  RESTRICTED: 6,
  VOTE: 7,
  REISSUE: 8,
  OWNER: 9,
  NULL_ADD_QUALIFIER: 10,
  INVALID: 11,
} as const;

/** Restricted operation flag values matching RestrictedType enum */
export const RestrictedType = {
  UNFREEZE_ADDRESS: 0,
  FREEZE_ADDRESS: 1,
  GLOBAL_UNFREEZE: 2,
  GLOBAL_FREEZE: 3,
} as const;

/** Qualifier operation values matching QualifierType enum */
export const QualifierType = {
  REMOVE_QUALIFIER: 0,
  ADD_QUALIFIER: 1,
} as const;

// ---- Binary serialization helpers ----

function writeVarString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  if (len > 252) throw new Error('Asset string too long: max 252 bytes');
  const result = new Uint8Array(1 + len);
  result[0] = len;
  result.set(bytes, 1);
  return result;
}

function writeInt64(value: number | bigint): Uint8Array {
  const bigVal = typeof value === 'number' ? BigInt(Math.floor(value)) : value;
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, bigVal, true);
  return buf;
}

function writeInt8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Wrap serialized bytes in OP_PHI_ASSET << pushdata(data) << OP_DROP script.
 *
 * The C++ CScript operator << does a pushdata encode before the bytes:
 *   script << OP_PHI_ASSET << ToByteVector(vchMessage) << OP_DROP
 * So we need: OP_PHI_ASSET, pushdata_len_byte, data..., OP_DROP
 *
 * @param data The message payload (magic bytes + serialized data)
 * @param magic Optional 4-byte magic prefix. If omitted, data is used as-is.
 */
export function buildAssetScript(data: Uint8Array, magic?: Uint8Array): string {
  // Prepend magic bytes if provided (matching C++ ConstructTransaction)
  const payload = magic ? concatBytes(magic, data) : data;

  // pushdata length byte (payload < 253 bytes for asset messages)
  const pushByte = payload.length < 0xfd ? payload.length : 0xfd;
  const script = new Uint8Array(1 + 1 + payload.length + 1); // OP_PHI_ASSET + pushbyte + payload + OP_DROP
  script[0] = OP_PHI_ASSET;
  script[1] = pushByte;
  script.set(payload, 2);
  script[2 + payload.length] = OP_DROP;
  return toHex(script);
}

// ---- CNewAsset serialization (asset issuance) ----

/**
 * Serialize CNewAsset per assettypes.h SerializationOp:
 * READWRITE(strName, nAmount, units, nReissuable, nHasIPFS);
 * if (nHasIPFS == 1) ReadWriteAssetHash(strIPFSHash);
 */
export function serializeCNewAsset(params: {
  name: string;
  amount: number;
  units: number;
  reissuable: number;
  hasIPFS: number;
  ipfsHash?: string;
}): Uint8Array {
  const parts: Uint8Array[] = [
    writeVarString(params.name),
    writeInt64(params.amount),
    writeInt8(params.units),
    writeInt8(params.reissuable),
    writeInt8(params.hasIPFS),
  ];
  if (params.hasIPFS === 1 && params.ipfsHash) {
    parts.push(serializeAssetHash(params.ipfsHash));
  }
  return concatBytes(...parts);
}

/**
 * Serialize IPFS/TXID hash per ReadWriteAssetHash:
 * 0x12 0x20 [32 bytes] for IPFS hash, 0x54 [32 bytes] for TXID
 */
function serializeAssetHash(hashStr: string): Uint8Array {
  if (hashStr.length === 34) {
    // IPFS SHA2-256: 0x12, 0x20, 32 bytes
    const hashBytes = new TextEncoder().encode(hashStr);
    const result = new Uint8Array(2 + hashBytes.length);
    result[0] = 0x12;
    result[1] = 0x20;
    result.set(hashBytes, 2);
    return result;
  } else if (hashStr.length === 32) {
    // TXID notifier: 0x54, 32 bytes
    const hashBytes = new TextEncoder().encode(hashStr);
    const result = new Uint8Array(1 + hashBytes.length);
    result[0] = 0x54;
    result.set(hashBytes, 1);
    return result;
  }
  return writeVarString(hashStr);
}

// ---- CAssetTransfer serialization (asset transfer) ----

/**
 * Serialize CAssetTransfer per assettypes.h SerializationOp:
 * READWRITE(strName, nAmount);
 * ReadWriteAssetHash(message) if valid IPFS, else message as varString;
 * if (nExpireTime != 0) READWRITE(nExpireTime);
 */
export function serializeCAssetTransfer(params: {
  name: string;
  amount: number;
  message?: string;
  expireTime?: number;
}): Uint8Array {
  const parts: Uint8Array[] = [
    writeVarString(params.name),
    writeInt64(params.amount),
  ];

  if (params.message && params.message.length > 0) {
    parts.push(writeVarString(params.message));
  } else {
    parts.push(writeVarString(''));
  }

  if (params.expireTime && params.expireTime !== 0) {
    parts.push(writeInt64(params.expireTime));
  }

  return concatBytes(...parts);
}

// ---- CReissueAsset serialization ----

/**
 * Serialize CReissueAsset per assettypes.h SerializationOp:
 * READWRITE(strName, nAmount, nUnits, nReissuable);
 * ReadWriteAssetHash(strIPFSHash);
 */
export function serializeCReissueAsset(params: {
  name: string;
  amount: number;
  units: number;
  reissuable: number;
  ipfsHash?: string;
}): Uint8Array {
  const parts: Uint8Array[] = [
    writeVarString(params.name),
    writeInt64(params.amount),
    writeInt8(params.units),
    writeInt8(params.reissuable),
  ];

  if (params.ipfsHash && params.ipfsHash.length > 0) {
    parts.push(serializeAssetHash(params.ipfsHash));
  } else {
    parts.push(writeVarString(''));
  }

  return concatBytes(...parts);
}

// ---- CNullAssetTxData serialization (freeze/unfreeze, qualifier) ----

/**
 * Serialize CNullAssetTxData per assettypes.h SerializationOp:
 * READWRITE(asset_name, flag);
 */
export function serializeCNullAssetTxData(params: {
  assetName: string;
  flag: number;
}): Uint8Array {
  return concatBytes(writeVarString(params.assetName), writeInt8(params.flag));
}

// ---- CNullAssetTxVerifierString serialization ----

/**
 * Serialize CNullAssetTxVerifierString per assettypes.h SerializationOp:
 * READWRITE(verifier_string);
 */
export function serializeCNullAssetTxVerifierString(verifierString: string): Uint8Array {
  return writeVarString(verifierString);
}

// ---- Raw transaction builder for asset transactions ----

function writeVarInt(value: number): Uint8Array {
  if (value < 0xfd) return new Uint8Array([value]);
  if (value <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, value, true);
    return buf;
  }
  if (value <= 0xffffffff) {
    const buf = new Uint8Array(5);
    buf[0] = 0xfe;
    new DataView(buf.buffer).setUint32(1, value, true);
    return buf;
  }
  const buf = new Uint8Array(9);
  buf[0] = 0xff;
  new DataView(buf.buffer).setBigInt64(1, BigInt(value), true);
  return buf;
}

/**
 * Build a raw transaction hex from inputs and outputs (with script hex support).
 * This is equivalent to `createrawtransaction` RPC but allows scriptPubKey as hex.
 */
export function buildRawTransaction(
  inputs: Array<{ txid: string; vout: number; sequence?: number }>,
  outputs: Array<{ scriptPubKey: string; valueSatoshis: number }>,
  locktime = 0
): string {
  const parts: Uint8Array[] = [];

  // Version
  const version = new Uint8Array(4);
  new DataView(version.buffer).setInt32(0, 2, true);
  parts.push(version);

  // Inputs
  parts.push(writeVarInt(inputs.length));
  for (const inp of inputs) {
    const txidBytes = hexToArray(inp.txid.split('').reverse().join(''));
    parts.push(txidBytes);

    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, inp.vout, true);
    parts.push(vout);

    parts.push(writeVarInt(0));
    parts.push(new Uint8Array(0));

    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setUint32(0, inp.sequence ?? 0xffffffff, true);
    parts.push(seq);
  }

  // Outputs
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setBigInt64(0, BigInt(out.valueSatoshis), true);
    parts.push(value);

    const script = hexToArray(out.scriptPubKey);
    parts.push(writeVarInt(script.length));
    parts.push(script);
  }

  // Locktime
  const locktimeBytes = new Uint8Array(4);
  new DataView(locktimeBytes.buffer).setUint32(0, locktime, true);
  parts.push(locktimeBytes);

  return toHex(concatBytes(...parts));
}

function hexToArray(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Hex string must have even length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ---- Helpers ----

/** Convert a number of PHI to satoshis */
export function toSatoshis(phiAmount: number): number {
  return Math.floor(phiAmount * 1e8);
}
