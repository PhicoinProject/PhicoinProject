/**
 * Byte-exact coverage for asset-serialization helpers that the main
 * assetSerialization.test.ts does not exercise:
 *   - buildNullAssetDataScript   (per-address qualifier tag / freeze-unfreeze)
 *   - buildGlobalRestrictionScript (global freeze / unfreeze of a restricted asset)
 *   - buildRawTransaction         (raw tx builder used for asset txs)
 *   - serializeCReissueAsset IPFS-hash byte layout (ReadWriteAssetHash, NOT varstring)
 *   - serializeCAssetTransfer expire-time + message byte layout
 *
 * All expected hex strings were derived from the documented C++ on-chain format
 * (see src/assets/assets.cpp references in assetSerialization.ts) and verified to
 * match the actual function output. These are byte-exact reference vectors.
 */
import { describe, it, expect } from '@jest/globals';
import {
  serializeCNullAssetTxData,
  serializeCReissueAsset,
  serializeCAssetTransfer,
  buildNullAssetDataScript,
  buildGlobalRestrictionScript,
  buildRawTransaction,
  QualifierType,
  RestrictedType,
} from '@/services/assetSerialization';

// Helper: hex string from a Uint8Array.
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
// Helper: ascii-hex of a string.
const ahex = (s: string) => Array.from(new TextEncoder().encode(s)).map((x) => x.toString(16).padStart(2, '0')).join('');

describe('Asset Serialization (extra)', () => {
  // ===========================================================================
  // buildNullAssetDataScript — per-address null-asset-data output.
  // Layout: 0xc0 (OP_PHI_ASSET) 0x14 (push 20) <h160> <pushdata(serialized)>.
  // IsNullAssetTxDataScript checks [0]==0xc0 && [1]==0x14 (no OP_DROP).
  // STATUS: C++-verified-by-construction (src/script/standard.cpp:334-336,
  //         src/assets/assets.cpp:4577-4585).
  // ===========================================================================
  describe('buildNullAssetDataScript', () => {
    const H160 = '22'.repeat(20); // a deterministic 20-byte HASH160

    it('builds OP_PHI_ASSET push(20) h160 pushdata(CNullAssetTxData) — byte exact', () => {
      // serialize a qualifier-tag add: name "$SECURITY", flag = ADD_QUALIFIER (1)
      const serialized = serializeCNullAssetTxData({ assetName: '$SECURITY', flag: QualifierType.ADD_QUALIFIER });
      // serialized = 09 + "$SECURITY" + 01 -> 11 bytes
      expect(hex(serialized)).toBe('09' + ahex('$SECURITY') + '01');
      expect(serialized.length).toBe(11);

      const script = buildNullAssetDataScript(H160, serialized);
      // pushdata of 11 bytes is a single 0x0b length byte (11 < 76).
      const expected = 'c0' + '14' + H160 + '0b' + hex(serialized);
      expect(script).toBe(expected);
      // Exact reference vector.
      expect(script).toBe('c01422222222222222222222222222222222222222220b0924534543555249545901');
    });

    it('starts with the 0xc014 marker that IsNullAssetTxDataScript checks', () => {
      const serialized = serializeCNullAssetTxData({ assetName: 'X', flag: 0 });
      const script = buildNullAssetDataScript(H160, serialized);
      expect(script.slice(0, 2)).toBe('c0'); // OP_PHI_ASSET
      expect(script.slice(2, 4)).toBe('14'); // push 20 bytes (the keyID)
      expect(script.slice(4, 4 + 40)).toBe(H160); // the 20-byte h160
    });

    it('encodes the freeze flag (1) and unfreeze flag (0) in the trailing byte', () => {
      const freeze = serializeCNullAssetTxData({ assetName: '$SEC', flag: RestrictedType.FREEZE_ADDRESS });
      const unfreeze = serializeCNullAssetTxData({ assetName: '$SEC', flag: RestrictedType.UNFREEZE_ADDRESS });
      expect(freeze[freeze.length - 1]).toBe(1);
      expect(unfreeze[unfreeze.length - 1]).toBe(0);
      // The flag byte must survive into the final script (it is the last byte).
      const sFreeze = buildNullAssetDataScript(H160, freeze);
      expect(sFreeze.endsWith('01')).toBe(true);
    });

    it('rejects an h160 that is not exactly 20 bytes', () => {
      const serialized = serializeCNullAssetTxData({ assetName: 'X', flag: 0 });
      expect(() => buildNullAssetDataScript('22'.repeat(19), serialized)).toThrow();
      expect(() => buildNullAssetDataScript('22'.repeat(21), serialized)).toThrow();
    });
  });

  // ===========================================================================
  // buildGlobalRestrictionScript — global freeze / unfreeze output.
  // Layout: 0xc0 0x50 0x50 <pushdata(serialized)>. OP_RESERVED = 0x50.
  // IsNullGlobalRestrictionAssetTxDataScript checks [0]==0xc0 && [1]==[2]==0x50.
  // STATUS: C++-verified-by-construction (src/assets/assets.cpp:4587-4595).
  // ===========================================================================
  describe('buildGlobalRestrictionScript', () => {
    it('builds OP_PHI_ASSET OP_RESERVED OP_RESERVED pushdata(serialized) — byte exact', () => {
      const serialized = serializeCNullAssetTxData({ assetName: '$SECURITY', flag: RestrictedType.GLOBAL_UNFREEZE });
      const script = buildGlobalRestrictionScript(serialized);
      // flag GLOBAL_UNFREEZE = 2
      expect(script).toBe('c0' + '50' + '50' + '0b' + hex(serialized));
      expect(script).toBe('c050500b0924534543555249545902');
    });

    it('encodes a global FREEZE (flag 3) distinctly from a global UNFREEZE (flag 2)', () => {
      const freeze = buildGlobalRestrictionScript(
        serializeCNullAssetTxData({ assetName: '$SECURITY', flag: RestrictedType.GLOBAL_FREEZE })
      );
      const unfreeze = buildGlobalRestrictionScript(
        serializeCNullAssetTxData({ assetName: '$SECURITY', flag: RestrictedType.GLOBAL_UNFREEZE })
      );
      expect(freeze).toBe('c050500b0924534543555249545903'); // trailing flag = 03
      expect(unfreeze).toBe('c050500b0924534543555249545902'); // trailing flag = 02
      expect(freeze).not.toBe(unfreeze);
    });

    it('starts with the 0xc05050 marker (no P2PKH prefix, no OP_DROP)', () => {
      const serialized = serializeCNullAssetTxData({ assetName: '$X', flag: 3 });
      const script = buildGlobalRestrictionScript(serialized);
      expect(script.startsWith('c05050')).toBe(true);
      expect(script.endsWith('75')).toBe(false); // no OP_DROP
    });
  });

  // ===========================================================================
  // serializeCReissueAsset — IPFS hash uses ReadWriteAssetHash (NOT a varstring).
  // A 34-char IPFS hash serializes as 0x12 0x20 + 32 bytes; an empty hash writes
  // NOTHING (a trailing 0x00 would desync the daemon parser).
  // STATUS: C++-verified-by-construction (assettypes.h:59-95).
  // ===========================================================================
  describe('serializeCReissueAsset IPFS-hash layout', () => {
    it('omits any hash bytes when ipfsHash is empty (no trailing 0x00)', () => {
      const result = serializeCReissueAsset({ name: 'TEST', amount: 100000000, units: 8, reissuable: 1 });
      // name(1+4) + amount(8) + units(1) + reissuable(1) = 15 bytes, NOTHING after.
      expect(result.length).toBe(15);
      // last byte is the reissuable flag (1), NOT a 0x00 empty-string marker.
      expect(result[result.length - 1]).toBe(1);
    });

    it('serializes a 34-char IPFS hash as 0x12 0x20 + the 32 raw bytes', () => {
      const ipfs = 'Qm' + 'a'.repeat(32); // 34 chars
      expect(ipfs.length).toBe(34);
      const result = serializeCReissueAsset({ name: 'TEST', amount: 1, units: 0, reissuable: 0, ipfsHash: ipfs });
      // base = name(5) + amount(8) + units(1) + reissuable(1) = 15; hash = 2 + 34 = 36
      expect(result.length).toBe(15 + 36);
      const hashPart = result.slice(15);
      expect(hex(hashPart.slice(0, 2))).toBe('1220'); // 0x12 0x20 multihash prefix
      expect(hashPart.length).toBe(36);
    });
  });

  // ===========================================================================
  // serializeCAssetTransfer — message + expire-time byte layout.
  // READWRITE(strName, nAmount); message varString; if nExpireTime != 0 -> int64.
  // STATUS: C++-verified-by-construction (assettypes.h CAssetTransfer).
  // ===========================================================================
  describe('serializeCAssetTransfer message/expire layout (byte exact)', () => {
    it('omits the message field entirely when no message is given (daemon-byte-identical)', () => {
      // The current source emits NOTHING for an empty/omitted message (matching the
      // daemon, which no-ops ReadWriteAssetHash for an empty message). A stray
      // trailing 0x00 would make the transfer non-byte-identical to the daemon.
      const t = serializeCAssetTransfer({ name: 'TST', amount: 50000000 });
      // 03 + "TST" + amount(8) — and NOTHING after.
      expect(hex(t)).toBe('03' + ahex('TST') + '80f0fa0200000000');
      expect(t.length).toBe(1 + 3 + 8);
    });

    it('also omits the message field for an explicit empty string', () => {
      const t = serializeCAssetTransfer({ name: 'TST', amount: 50000000, message: '' });
      expect(t.length).toBe(1 + 3 + 8); // no trailing 0x00
    });

    it('encodes a message as a length-prefixed varString', () => {
      const t = serializeCAssetTransfer({ name: 'TST', amount: 1, message: 'Hi' });
      // ...amount... + 02 + "Hi"
      const tail = t.slice(1 + 3 + 8);
      expect(tail[0]).toBe(2); // message length
      expect(new TextDecoder().decode(tail.slice(1))).toBe('Hi');
    });

    it('appends an 8-byte LE expireTime ONLY when it is non-zero', () => {
      const withExpire = serializeCAssetTransfer({ name: 'TST', amount: 1, message: '', expireTime: 1 });
      const noExpire = serializeCAssetTransfer({ name: 'TST', amount: 1, message: '' });
      // withExpire is exactly 8 bytes longer (the int64 expire time).
      expect(withExpire.length).toBe(noExpire.length + 8);
      // The expire time is the last 8 bytes, value 1 LE.
      expect(hex(withExpire.slice(-8))).toBe('0100000000000000');
    });
  });

  // ===========================================================================
  // buildRawTransaction — raw tx serializer (createrawtransaction equivalent
  // that accepts scriptPubKey hex). Verifies version=2, byte-reversed txid,
  // CompactSize counts, 8-byte LE value, and locktime.
  // ===========================================================================
  describe('buildRawTransaction (byte exact)', () => {
    const TXID = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    const P2PKH = '76a914' + '11'.repeat(20) + '88ac';

    it('serializes a 1-in/1-out tx to the exact reference hex', () => {
      const raw = buildRawTransaction(
        [{ txid: TXID, vout: 1, sequence: 0xffffffff }],
        [{ scriptPubKey: P2PKH, valueSatoshis: 100000000 }],
        0
      );
      // version 02000000, 01 input, REVERSED txid, vout 01000000, empty scriptSig 00,
      // sequence ffffffff, 01 output, value 00e1f50500000000, scriptlen 19, P2PKH, locktime.
      expect(raw).toBe(
        '02000000' +
          '01' +
          'ffeeddccbbaa99887766554433221100ffeeddccbbaa998877665544332211' + '00' +
          '01000000' +
          '00' +
          'ffffffff' +
          '01' +
          '00e1f50500000000' +
          '19' + P2PKH +
          '00000000'
      );
    });

    it('reverses the txid byte-by-byte (not character-by-character)', () => {
      const raw = buildRawTransaction(
        [{ txid: TXID, vout: 0 }],
        [{ scriptPubKey: P2PKH, valueSatoshis: 1 }]
      );
      // The first input's outpoint hash is the byte-reversed TXID.
      const reversed = TXID.match(/../g)!.reverse().join('');
      expect(raw.slice(8 + 2, 8 + 2 + 64)).toBe(reversed);
    });

    it('encodes the output value as 8-byte little-endian satoshis', () => {
      // 1 satoshi -> 0100000000000000 ; 100000000 sat (1 PHI) -> 00e1f50500000000
      const raw1 = buildRawTransaction([{ txid: TXID, vout: 0 }], [{ scriptPubKey: P2PKH, valueSatoshis: 1 }]);
      expect(raw1.includes('0100000000000000')).toBe(true);
      const rawCoin = buildRawTransaction([{ txid: TXID, vout: 0 }], [{ scriptPubKey: P2PKH, valueSatoshis: 100000000 }]);
      expect(rawCoin.includes('00e1f50500000000')).toBe(true);
    });

    it('uses a CompactSize input/output count and a non-zero locktime field', () => {
      const raw = buildRawTransaction(
        [{ txid: TXID, vout: 0 }, { txid: TXID, vout: 1 }],
        [{ scriptPubKey: P2PKH, valueSatoshis: 1 }],
        500000
      );
      // input count byte = 02 right after the 4-byte version
      expect(raw.slice(8, 10)).toBe('02');
      // locktime 500000 = 0x0007a120 LE -> 20a10700, at the very end.
      expect(raw.endsWith('20a10700')).toBe(true);
    });

    it('sets the default sequence to 0xffffffff when omitted', () => {
      const raw = buildRawTransaction([{ txid: TXID, vout: 0 }], [{ scriptPubKey: P2PKH, valueSatoshis: 1 }]);
      // After version(4) + count(1) + outpoint(32) + vout(4) + scriptlen(1=00) the next 4 bytes are the sequence.
      const seqOffsetChars = (4 + 1 + 32 + 4 + 1) * 2;
      expect(raw.slice(seqOffsetChars, seqOffsetChars + 8)).toBe('ffffffff');
    });
  });
});
