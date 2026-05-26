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
 *   OP_PHI_ASSET (0xc0) << pushdata_len << [magic][serialized] << OP_DROP (0x75)
 */

const OP_PHI_ASSET = 0xc0;
const OP_DROP = 0x75;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;

/**
 * Encode a payload using Bitcoin SCRIPT pushdata semantics (NOT Bitcoin varint).
 *
 * This matches C++ `CScript::operator<<(const std::vector<unsigned char>&)`
 * (src/script/script.h) and the asset-script parser in src/assets/assets.cpp
 * which reads OP_PUSHDATA1 (0x4c) / OP_PUSHDATA2 (0x4d):
 *   - len  < 76    -> single direct length byte
 *   - len 76..255  -> 0x4c then 1 length byte
 *   - len 256..65535 -> 0x4d then 2 length bytes little-endian
 *
 * Returns the pushdata prefix (opcode + length) followed by the payload bytes.
 */
function pushData(payload: Uint8Array): Uint8Array {
  const len = payload.length;
  let prefix: Uint8Array;
  if (len < OP_PUSHDATA1) {
    // Direct push: single length byte (keeps small payloads identical to before)
    prefix = new Uint8Array([len]);
  } else if (len <= 0xff) {
    // OP_PUSHDATA1 + 1-byte length
    prefix = new Uint8Array([OP_PUSHDATA1, len]);
  } else if (len <= 0xffff) {
    // OP_PUSHDATA2 + 2-byte little-endian length
    prefix = new Uint8Array([OP_PUSHDATA2, len & 0xff, (len >> 8) & 0xff]);
  } else {
    throw new Error('Asset script payload too large: max 65535 bytes');
  }
  return concatBytes(prefix, payload);
}

// Magic byte prefixes matching src/assets/assets.h
export const MAGIC_NEW_ASSET = new Uint8Array([114, 118, 110, 113]); // 'r','v','n','q'
export const MAGIC_ASSET_TRANSFER = new Uint8Array([114, 118, 110, 116]); // 'r','v','n','t'
export const MAGIC_REISSUE_ASSET = new Uint8Array([114, 118, 110, 114]); // 'r','v','n','r'
export const MAGIC_OWNER_ASSET = new Uint8Array([114, 118, 110, 111]); // 'r','v','n','o'

// OWNER_TAG and standard amounts (src/assets/assets.h):
//   #define OWNER_TAG "!"            (assets.h:33)
//   #define OWNER_ASSET_AMOUNT 1 * COIN (assets.h:36)  -> 100000000 sat
//   #define UNIQUE_ASSET_AMOUNT 1 * COIN (assets.h:37)
//   #define UNIQUE_ASSET_UNITS 0        (assets.h:38)
//   #define UNIQUE_ASSETS_REISSUABLE 0  (assets.h:39)
export const OWNER_TAG = '!';
export const OWNER_ASSET_AMOUNT = 100000000; // 1 * COIN in satoshis

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

  // Bitcoin SCRIPT pushdata encode the payload (direct / OP_PUSHDATA1 / OP_PUSHDATA2),
  // matching C++ `script << OP_PHI_ASSET << ToByteVector(vchMessage) << OP_DROP`.
  const pushed = pushData(payload);
  const script = new Uint8Array(1 + pushed.length + 1); // OP_PHI_ASSET + pushdata + OP_DROP
  script[0] = OP_PHI_ASSET;
  script.set(pushed, 1);
  script[1 + pushed.length] = OP_DROP;
  return toHex(script);
}

/**
 * Pushdata-encode an asset payload (after OP_PHI_ASSET) as a hex string,
 * without the surrounding OP_PHI_ASSET / OP_DROP wrapper.
 *
 * Use this when manually concatenating a P2PKH prefix + OP_PHI_ASSET (0xc0)
 * + <pushdata> + OP_DROP (0x75) in services/assets.ts so the pushdata length
 * encoding stays consistent with buildAssetScript().
 */
export function encodeAssetPushData(payload: Uint8Array): string {
  return toHex(pushData(payload));
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

  // The daemon emits NOTHING for an empty message (ReadWriteAssetHash no-ops). The
  // previous code pushed an empty varstring (a stray trailing 0x00), which the daemon
  // tolerates but makes transfers non-byte-identical to it — omit it here.
  if (params.message && params.message.length > 0) {
    parts.push(writeVarString(params.message));
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

  // IPFS hash uses ReadWriteAssetHash (assettypes.h:59-95), NOT a varstring: it
  // serializes the 34-byte (0x12 0x20 + 32) or 32-byte hash, and writes NOTHING
  // for an empty/other-length hash. Emitting an empty varstring (a trailing 0x00)
  // leaves an unconsumed byte and the daemon rejects the tx with
  // "bad-txns-reissue-serialization-failed".
  if (params.ipfsHash && params.ipfsHash.length > 0) {
    parts.push(serializeAssetHash(params.ipfsHash));
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

// ---- Owner-token output (rvno) serialization ----

/**
 * Serialize the owner-token payload that CNewAsset::ConstructOwnerTransaction
 * writes (src/assets/assets.cpp:564-577):
 *
 *   CDataStream ssOwner; ssOwner << std::string(strName + OWNER_TAG);
 *   vchMessage = { 'r','v','n','o' } + ssOwner
 *   script << OP_PHI_ASSET << ToByteVector(vchMessage) << OP_DROP
 *
 * `CDataStream << std::string` writes a CompactSize length prefix followed by
 * the raw bytes — identical to writeVarString() for names < 253 bytes.
 *
 * `assetName` is the BASE asset name WITHOUT the trailing "!"; this helper
 * appends OWNER_TAG, matching the C++ which does `strName + OWNER_TAG`.
 *
 * Returns the payload AFTER the magic bytes are prepended (i.e. magic + body),
 * ready to be pushdata-encoded between OP_PHI_ASSET and OP_DROP.
 */
export function serializeOwnerPayload(assetName: string): Uint8Array {
  const body = writeVarString(assetName + OWNER_TAG);
  return concatBytes(MAGIC_OWNER_ASSET, body);
}

/**
 * Build the full owner-token output scriptPubKey for an asset issuance.
 * Layout: <P2PKH(recipient)> OP_PHI_ASSET(0xc0) <pushdata(rvno + name!)> OP_DROP(0x61)
 *
 * The C++ owner output is created in CWallet::CreateTransactionWithAssets
 * (src/wallet/wallet.cpp:3609-3612) via GetScriptForDestination(destination)
 * extended by ConstructOwnerTransaction, with value 0.
 *
 * @param p2pkhHex P2PKH scriptPubKey hex of the recipient (issuer destination)
 * @param assetName BASE asset name without the trailing "!"
 */
export function buildOwnerOutputScript(p2pkhHex: string, assetName: string): string {
  const payload = serializeOwnerPayload(assetName);
  return p2pkhHex + 'c0' + encodeAssetPushData(payload) + '75';
}

// ---- Verifier-string output (restricted assets) ----

/**
 * Strip a restricted-asset verifier string the same way the daemon does in
 * GetStrippedVerifierString (src/assets/assets.cpp:4907-4916):
 *   - remove all whitespace
 *   - remove all '#' (QUALIFIER_CHAR) characters
 * The stripped form is what gets serialized on-chain.
 */
export function stripVerifierString(verifier: string): string {
  return verifier.replace(/\s/g, '').replace(/#/g, '');
}

/**
 * Build the restricted-asset verifier output scriptPubKey.
 *
 * Per CNullAssetTxVerifierString::ConstructTransaction (src/assets/assets.cpp:4603-4611):
 *   script << OP_PHI_ASSET << OP_RESERVED << ToByteVector(vchMessage)
 * where vchMessage is the raw serialized verifier string (no magic prefix).
 *
 * OP_RESERVED is 0x50. There is NO P2PKH prefix and NO OP_DROP — this is a
 * data-only "null asset" output with value 0.
 *
 * The verifier string is stripped (whitespace + '#') to match the daemon, which
 * serializes GetStrippedVerifierString(verifier) (assets.cpp:2555, 4042-4051).
 *
 * @param verifierString the verifier string (will be stripped before encoding)
 */
export function buildVerifierOutputScript(verifierString: string): string {
  const body = serializeCNullAssetTxVerifierString(stripVerifierString(verifierString));
  // OP_PHI_ASSET (0xc0) + OP_RESERVED (0x50) + pushdata(body)
  return 'c0' + '50' + encodeAssetPushData(body);
}

/**
 * Build a per-address null-asset-data output scriptPubKey (qualifier tag /
 * restricted address freeze-unfreeze).
 *
 * Per CNullAssetScriptVisitor (src/script/standard.cpp:334-336) the destination
 * script is `OP_PHI_ASSET << ToByteVector(keyID)` = 0xc0 0x14 <20-byte h160>,
 * then CNullAssetTxData::ConstructTransaction (assets.cpp:4577-4585) appends
 * `<< ToByteVector(vchMessage)` = a pushdata of the serialized CNullAssetTxData.
 * There is NO OP_DROP. IsNullAssetTxDataScript checks [0]==0xc0 && [1]==0x14.
 *
 * @param h160Hex the 20-byte (40 hex char) HASH160 of the target address
 * @param serialized serialized CNullAssetTxData (asset name varstring + flag)
 */
export function buildNullAssetDataScript(h160Hex: string, serialized: Uint8Array): string {
  if (h160Hex.length !== 40) throw new Error('h160 must be 20 bytes (40 hex chars)');
  return 'c0' + '14' + h160Hex + encodeAssetPushData(serialized);
}

/**
 * Build a global restriction null-asset-data output scriptPubKey (global
 * freeze / unfreeze of a restricted asset).
 *
 * Per CNullAssetTxData::ConstructGlobalRestrictionTransaction (assets.cpp:4587-4595):
 *   script << OP_PHI_ASSET << OP_RESERVED << OP_RESERVED << ToByteVector(vchMessage)
 * = 0xc0 0x50 0x50 <pushdata(serialized)>. No P2PKH prefix, no OP_DROP.
 * IsNullGlobalRestrictionAssetTxDataScript checks [0]==0xc0 && [1]==[2]==0x50.
 *
 * @param serialized serialized CNullAssetTxData (asset name varstring + flag)
 */
export function buildGlobalRestrictionScript(serialized: Uint8Array): string {
  return 'c0' + '50' + '50' + encodeAssetPushData(serialized);
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
    // Reverse txid byte-by-byte (NOT character-by-character)
    const txidBytesReversed = new Uint8Array(32);
    for (let j = 0; j < 32; j++) txidBytesReversed[j] = hexToArray(inp.txid)[31 - j];
    parts.push(txidBytesReversed);

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
  return Math.round(phiAmount * 1e8);
}
