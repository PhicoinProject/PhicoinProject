import { describe, it, expect } from '@jest/globals';
import {
  serializeCNewAsset,
  serializeCAssetTransfer,
  serializeCReissueAsset,
  serializeCNullAssetTxData,
  serializeCNullAssetTxVerifierString,
  serializeOwnerPayload,
  buildOwnerOutputScript,
  buildVerifierOutputScript,
  stripVerifierString,
  buildAssetScript,
  encodeAssetPushData,
  toSatoshis,
  MAGIC_NEW_ASSET,
  MAGIC_ASSET_TRANSFER,
  MAGIC_OWNER_ASSET,
  OWNER_ASSET_AMOUNT,
} from '@/services/assetSerialization';

// Helper: hex string from a Uint8Array.
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
// Helper: ascii-hex of a string.
const ahex = (s: string) => Array.from(new TextEncoder().encode(s)).map((x) => x.toString(16).padStart(2, '0')).join('');

describe('Asset Serialization', () => {
  describe('toSatoshis', () => {
    it('should convert PHI to satoshis correctly', () => {
      expect(toSatoshis(1)).toBe(100000000);
      expect(toSatoshis(0.5)).toBe(50000000);
      expect(toSatoshis(0.00000001)).toBe(1);
      expect(toSatoshis(0)).toBe(0);
    });
  });

  describe('buildAssetScript', () => {
    it('should wrap data with OP_PHI_ASSET and OP_DROP', () => {
      const data = new Uint8Array([0x01, 0x02, 0x03]);
      const hex = buildAssetScript(data);
      // OP_PHI_ASSET = 0xc0, pushdata len = 0x03, data 010203, OP_DROP = 0x61.
      // CScript << ToByteVector(data) prepends the pushdata length byte (Bitcoin
      // script semantics, matched by the C++ asset-script parser), so the length
      // byte IS part of the correct on-chain output.
      expect(hex).toBe('c00301020375');
    });

    it('should handle empty data', () => {
      const data = new Uint8Array([]);
      const hex = buildAssetScript(data);
      // OP_PHI_ASSET (0xc0), empty push (0x00), OP_DROP (0x61).
      expect(hex).toBe('c00075');
    });

    // ---- Bitcoin SCRIPT pushdata encoding (NOT varint) ----
    // The on-chain asset script after OP_PHI_ASSET uses Bitcoin SCRIPT pushdata:
    //   len < 76        -> single direct length byte (e.g. 0x4b == 75)
    //   len 76..255     -> OP_PUSHDATA1 (0x4c) then 1 length byte
    //   len 256..65535  -> OP_PUSHDATA2 (0x4d) then 2 bytes little-endian
    // This matches C++ CScript::operator<<(vector) and src/assets/assets.cpp.
    it('should use a single direct length byte for a 75-byte payload (boundary, no opcode)', () => {
      const data = new Uint8Array(75).fill(0xab);
      const hex = buildAssetScript(data);
      // c0 (OP_PHI_ASSET) + 4b (direct length 75) + payload + 61 (OP_DROP)
      expect(hex.startsWith('c04b')).toBe(true);
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4b'); // 75 direct, NOT 0x4c pushdata
      expect(hex.endsWith('75')).toBe(true);
      // Total hex length: (1 + 1 + 75 + 1) bytes * 2
      expect(hex.length).toBe((1 + 1 + 75 + 1) * 2);
    });

    it('should use OP_PUSHDATA1 (0x4c) for a 76-byte payload (boundary)', () => {
      const data = new Uint8Array(76).fill(0xcd);
      const hex = buildAssetScript(data);
      // c0 (OP_PHI_ASSET) + 4c (OP_PUSHDATA1) + 4c (length 76) + payload + 61
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4c'); // OP_PUSHDATA1
      expect(hex.slice(4, 6)).toBe('4c'); // length 76 == 0x4c
      expect(hex.endsWith('75')).toBe(true);
      // Total: (1 + 1 + 1 + 76 + 1) bytes * 2
      expect(hex.length).toBe((1 + 2 + 76 + 1) * 2);
    });

    it('should use OP_PUSHDATA1 (0x4c) for a 255-byte payload (upper boundary)', () => {
      const data = new Uint8Array(255).fill(0x11);
      const hex = buildAssetScript(data);
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4c'); // OP_PUSHDATA1
      expect(hex.slice(4, 6)).toBe('ff'); // length 255 == 0xff
      expect(hex.endsWith('75')).toBe(true);
    });

    it('should use OP_PUSHDATA2 (0x4d) + LE length for a ~200-byte... 300-byte payload', () => {
      const data = new Uint8Array(300).fill(0x22);
      const hex = buildAssetScript(data);
      // c0 + 4d (OP_PUSHDATA2) + 2c01 (300 little-endian = 0x012c -> bytes 0x2c 0x01) + payload + 61
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4d'); // OP_PUSHDATA2
      expect(hex.slice(4, 8)).toBe('2c01'); // 300 = 0x012c, little-endian -> 2c 01
      expect(hex.endsWith('75')).toBe(true);
      // Total: (1 + 1 + 2 + 300 + 1) bytes * 2
      expect(hex.length).toBe((1 + 3 + 300 + 1) * 2);
    });

    it('should keep the documented small-payload output identical (regression)', () => {
      // 3-byte payload must still produce c00301020375 (no pushdata opcode).
      expect(buildAssetScript(new Uint8Array([0x01, 0x02, 0x03]))).toBe('c00301020375');
    });
  });

  describe('encodeAssetPushData', () => {
    it('should direct-push a payload shorter than 76 bytes', () => {
      expect(encodeAssetPushData(new Uint8Array([0xaa, 0xbb]))).toBe('02aabb');
    });

    it('should prefix OP_PUSHDATA1 for 76..255 byte payloads', () => {
      const out = encodeAssetPushData(new Uint8Array(80).fill(0x01));
      expect(out.startsWith('4c50')).toBe(true); // 0x4c then length 80 (0x50)
    });

    it('should prefix OP_PUSHDATA2 + LE length for 256..65535 byte payloads', () => {
      const out = encodeAssetPushData(new Uint8Array(256).fill(0x01));
      expect(out.startsWith('4d0001')).toBe(true); // 0x4d then 256 LE = 00 01
    });

    it('should throw for payloads larger than 65535 bytes', () => {
      expect(() => encodeAssetPushData(new Uint8Array(65536))).toThrow();
    });
  });

  describe('serializeCNewAsset', () => {
    it('should serialize a basic asset', () => {
      const result = serializeCNewAsset({
        name: 'TEST',
        amount: 100000000,
        units: 8,
        reissuable: 0,
        hasIPFS: 0,
      });

      // strName: 0x04 (length) + 'TEST' = 4 bytes + 1 byte = 5 bytes
      // nAmount: 8 bytes LE
      // units: 1 byte
      // nReissuable: 1 byte
      // nHasIPFS: 1 byte
      expect(result.length).toBe(5 + 8 + 1 + 1 + 1);

      // Check the name prefix
      expect(result[0]).toBe(4); // length of "TEST"
      const nameBytes = new TextDecoder().decode(result.slice(1, 5));
      expect(nameBytes).toBe('TEST');
    });

    it('should handle longer asset names', () => {
      const result = serializeCNewAsset({
        name: 'MyLongAssetName',
        amount: 200000000,
        units: 8,
        reissuable: 1,
        hasIPFS: 0,
      });

      const nameLen = result[0];
      expect(nameLen).toBe(15);
      const nameBytes = new TextDecoder().decode(result.slice(1, 1 + nameLen));
      expect(nameBytes).toBe('MyLongAssetName');
    });

    it('should include IPFS hash when hasIPFS is 1', () => {
      const result = serializeCNewAsset({
        name: 'NFT',
        amount: 100000000,
        units: 0,
        reissuable: 0,
        hasIPFS: 1,
        ipfsHash: '1220' + 'a'.repeat(32),
      });

      // name (1 + 3) + amount (8) + units (1) + reissuable (1) + hasIPFS (1) + hash bytes
      const baseLen = 4 + 8 + 1 + 1 + 1;
      expect(result.length).toBeGreaterThan(baseLen);
    });

    it('should throw for names longer than 252 bytes', () => {
      expect(() =>
        serializeCNewAsset({
          name: 'a'.repeat(253),
          amount: 1,
          units: 0,
          reissuable: 0,
          hasIPFS: 0,
        })
      ).toThrow();
    });
  });

  describe('serializeCAssetTransfer', () => {
    it('should serialize a basic transfer', () => {
      const result = serializeCAssetTransfer({
        name: 'TEST',
        amount: 50000000,
      });

      expect(result[0]).toBe(4);
      const nameBytes = new TextDecoder().decode(result.slice(1, 5));
      expect(nameBytes).toBe('TEST');
    });

    it('should include message when provided', () => {
      const result = serializeCAssetTransfer({
        name: 'TEST',
        amount: 50000000,
        message: 'Hello',
      });

      // name (5) + amount (8) + message (1 + 5) = 19 bytes
      expect(result.length).toBe(19);
    });

    it('should include expire time when non-zero', () => {
      const result = serializeCAssetTransfer({
        name: 'TEST',
        amount: 50000000,
        message: '',
        expireTime: 1234567890,
      });

      // name (5) + amount (8) + expireTime (8) = 21.
      // The source emits NOTHING for an empty message (daemon-byte-identical), so
      // there is no trailing 0x00 empty-message byte between amount and expireTime.
      expect(result.length).toBe(21);
    });
  });

  describe('serializeCReissueAsset', () => {
    it('should serialize a reissue', () => {
      const result = serializeCReissueAsset({
        name: 'TEST',
        amount: 100000000,
        units: 8,
        reissuable: 1,
      });

      expect(result[0]).toBe(4);
      // name(1+4) + amount(8) + units(1) + reissuable(1) = 15.
      // An empty IPFS hash uses ReadWriteAssetHash, which writes NOTHING (no empty
      // varstring) — emitting a trailing 0x00 would desync the daemon parser and
      // trigger "bad-txns-reissue-serialization-failed".
      expect(result.length).toBe(15);
    });

    it('should include IPFS hash when provided', () => {
      const result = serializeCReissueAsset({
        name: 'TEST',
        amount: 100000000,
        units: 8,
        reissuable: 0,
        ipfsHash: '1220' + 'b'.repeat(32),
      });

      expect(result.length).toBeGreaterThan(15);
    });
  });

  describe('serializeCNullAssetTxData', () => {
    it('should serialize freeze/unfreeze operations', () => {
      const result = serializeCNullAssetTxData({
        assetName: 'RESTRICTED',
        flag: 1,
      });

      // name (1 + 10) + flag (1) = 12
      expect(result.length).toBe(12);
      expect(result[0]).toBe(10);
      expect(result[11]).toBe(1);
    });

    it('should handle global freeze flag', () => {
      const result = serializeCNullAssetTxData({
        assetName: 'RESTRICTED',
        flag: 3,
      });

      expect(result[11]).toBe(3);
    });
  });

  describe('serializeCNullAssetTxVerifierString', () => {
    it('should serialize a verifier string', () => {
      const result = serializeCNullAssetTxVerifierString('abc123');
      expect(result[0]).toBe(6);
      const str = new TextDecoder().decode(result.slice(1));
      expect(str).toBe('abc123');
    });

    it('should handle empty string', () => {
      const result = serializeCNullAssetTxVerifierString('');
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0);
    });
  });

  describe('Integration: build complete asset script', () => {
    it('should build a complete issue asset script', () => {
      const serialized = serializeCNewAsset({
        name: 'MYTOKEN',
        amount: 10000000000,
        units: 8,
        reissuable: 1,
        hasIPFS: 0,
      });
      const scriptHex = buildAssetScript(serialized);

      expect(scriptHex.startsWith('c0')).toBe(true);
      expect(scriptHex.endsWith('75')).toBe(true);
    });

    it('should build a complete transfer asset script', () => {
      const serialized = serializeCAssetTransfer({
        name: 'MYTOKEN',
        amount: 50000000,
        message: 'Payment',
      });
      const scriptHex = buildAssetScript(serialized);

      expect(scriptHex.startsWith('c0')).toBe(true);
      expect(scriptHex.endsWith('75')).toBe(true);
    });
  });

  // ===========================================================================
  // Owner-token (rvno) output — used by ROOT and SUB issuance.
  // Derived from CNewAsset::ConstructOwnerTransaction (src/assets/assets.cpp:564-577):
  //   ssOwner << std::string(strName + OWNER_TAG);  // CompactSize length + bytes
  //   vchMessage = {'r','v','n','o'} + ssOwner
  //   script << OP_PHI_ASSET << ToByteVector(vchMessage) << OP_DROP
  // STATUS: C++-verified-by-construction (byte layout matches the reference).
  // ===========================================================================
  describe('serializeOwnerPayload (rvno)', () => {
    it('prepends the rvno magic and appends OWNER_TAG to the name', () => {
      const payload = serializeOwnerPayload('MYTOKEN');
      // magic 'rvno' = 72 76 6e 6f
      expect(hex(MAGIC_OWNER_ASSET)).toBe('72766e6f');
      expect(hex(payload.slice(0, 4))).toBe('72766e6f');
      // length byte = 8 ("MYTOKEN!" is 8 bytes)
      expect(payload[4]).toBe(8);
      // name bytes = "MYTOKEN!"
      expect(new TextDecoder().decode(payload.slice(5))).toBe('MYTOKEN!');
      // Full payload byte layout
      expect(hex(payload)).toBe('72766e6f' + '08' + ahex('MYTOKEN!'));
    });

    it('handles SUB parent owner names (PARENT/SUB!)', () => {
      const payload = serializeOwnerPayload('PARENT/SUB');
      expect(payload[4]).toBe('PARENT/SUB!'.length); // 11
      expect(new TextDecoder().decode(payload.slice(5))).toBe('PARENT/SUB!');
    });
  });

  describe('buildOwnerOutputScript', () => {
    // A fixed, valid 25-byte P2PKH prefix for layout assertions.
    const P2PKH = '76a914' + '11'.repeat(20) + '88ac';

    it('builds <P2PKH> OP_PHI_ASSET pushdata(rvno + name!) OP_DROP', () => {
      const script = buildOwnerOutputScript(P2PKH, 'MYTOKEN');
      const payloadHex = '72766e6f' + '08' + ahex('MYTOKEN!'); // 13 bytes
      const pushLen = (payloadHex.length / 2).toString(16).padStart(2, '0'); // 0d
      expect(script).toBe(P2PKH + 'c0' + pushLen + payloadHex + '75');
      // Structural checks
      expect(script.startsWith(P2PKH)).toBe(true);
      expect(script.slice(P2PKH.length, P2PKH.length + 2)).toBe('c0'); // OP_PHI_ASSET
      expect(script.endsWith('75')).toBe(true);                        // OP_DROP
    });

    it('owner payload has NO trailing 8-byte amount (canonical C++ form)', () => {
      // CNewAsset::ConstructOwnerTransaction serializes ONLY the name string.
      // The owner payload after the rvno magic must be exactly varString(name!),
      // i.e. 13 bytes for "MYTOKEN" (4 magic + 1 len + 8 name), with no amount.
      const payload = serializeOwnerPayload('MYTOKEN');
      expect(payload.length).toBe(4 + 1 + 'MYTOKEN!'.length); // 13, NOT 13+8
    });
  });

  // ===========================================================================
  // Verifier-string output — restricted-asset issuance.
  // CNullAssetTxVerifierString::ConstructTransaction (src/assets/assets.cpp:4603-4611):
  //   script << OP_PHI_ASSET << OP_RESERVED << ToByteVector(vchMessage)
  //   (no P2PKH prefix, no OP_DROP, no magic; OP_RESERVED = 0x50).
  // STATUS: C++-verified-by-construction.
  // ===========================================================================
  describe('buildVerifierOutputScript', () => {
    it('builds OP_PHI_ASSET OP_RESERVED pushdata(verifier)', () => {
      const verifier = 'KYC';
      const script = buildVerifierOutputScript(verifier);
      // body = varString("KYC") = 03 4b 59 43
      const body = '03' + ahex('KYC');
      const pushLen = (body.length / 2).toString(16).padStart(2, '0'); // 04
      expect(script).toBe('c0' + '50' + pushLen + body);
      expect(script.startsWith('c050')).toBe(true);
      // No OP_DROP terminator (null-asset verifier output is data-only).
      expect(script.endsWith('75')).toBe(false);
    });

    it('handles an empty verifier string', () => {
      const script = buildVerifierOutputScript('');
      // body = varString("") = 00 ; pushdata(00) = 01 00
      expect(script).toBe('c0' + '50' + '01' + '00');
    });

    it('strips whitespace and # before encoding (matches GetStrippedVerifierString)', () => {
      // "#KYC & !#AML" -> "KYC&!AML"
      expect(stripVerifierString('#KYC & !#AML')).toBe('KYC&!AML');
      const script = buildVerifierOutputScript('#KYC & !#AML');
      const body = (() => {
        const stripped = 'KYC&!AML';
        return stripped.length.toString(16).padStart(2, '0') + ahex(stripped);
      })();
      const pushLen = (body.length / 2).toString(16).padStart(2, '0');
      expect(script).toBe('c0' + '50' + pushLen + body);
    });
  });

  // ===========================================================================
  // Per-type CNewAsset issue payloads (the rvnq output body) — byte-level.
  // The on-chain issue output is always:
  //   <P2PKH> OP_PHI_ASSET pushdata( 'rvnq' + CNewAsset ) OP_DROP
  // and is the LAST vout (src/assets/assets.cpp:586). The field values per type
  // come from the RPC handlers:
  //   UNIQUE  : amount=1*COIN, units=0, reissuable=0 (assets.h:37-39)
  //   QUALIFIER: units=0, reissuable=0 (rpc/assets.cpp:2434-2435)
  // STATUS: C++-verified-by-construction (serialization format + field values).
  // ===========================================================================
  describe('CNewAsset issue payloads by type', () => {
    it('rvnq magic is r,v,n,q', () => {
      expect(hex(MAGIC_NEW_ASSET)).toBe('72766e71');
    });

    it('SUB issue payload: name PARENT/SUB, divisible token', () => {
      const data = serializeCNewAsset({
        name: 'PARENT/SUB',
        amount: 100000000, // 1 token
        units: 0,
        reissuable: 1,
        hasIPFS: 0,
      });
      // strName: len(10)=0a + "PARENT/SUB"
      expect(data[0]).toBe('PARENT/SUB'.length); // 10
      expect(new TextDecoder().decode(data.slice(1, 1 + 10))).toBe('PARENT/SUB');
      // amount(8) + units(1) + reissuable(1) + hasIPFS(1)
      expect(data.length).toBe(1 + 10 + 8 + 1 + 1 + 1);
      const tail = data.slice(1 + 10);
      // amount LE 100000000 = 00e1f505 00000000
      expect(hex(tail.slice(0, 8))).toBe('00e1f50500000000');
      expect(tail[8]).toBe(0); // units
      expect(tail[9]).toBe(1); // reissuable
      expect(tail[10]).toBe(0); // hasIPFS
    });

    it('UNIQUE issue payload: amount=1*COIN, units=0, reissuable=0', () => {
      const data = serializeCNewAsset({
        name: 'PARENT#SERIAL001',
        amount: OWNER_ASSET_AMOUNT, // UNIQUE_ASSET_AMOUNT = 1 * COIN
        units: 0,
        reissuable: 0,
        hasIPFS: 0,
      });
      const nameLen = 'PARENT#SERIAL001'.length; // 16
      expect(data[0]).toBe(nameLen);
      const tail = data.slice(1 + nameLen);
      expect(hex(tail.slice(0, 8))).toBe('00e1f50500000000'); // 100000000 LE
      expect(tail[8]).toBe(0); // units = 0
      expect(tail[9]).toBe(0); // reissuable = 0
      expect(tail[10]).toBe(0); // hasIPFS = 0
    });

    it('QUALIFIER issue payload: name keeps the # prefix, units=0, reissuable=0', () => {
      const data = serializeCNewAsset({
        name: '#KYC',
        amount: 100000000,
        units: 0,
        reissuable: 0,
        hasIPFS: 0,
      });
      expect(data[0]).toBe('#KYC'.length); // 4
      expect(new TextDecoder().decode(data.slice(1, 1 + 4))).toBe('#KYC');
      const tail = data.slice(1 + 4);
      expect(tail[8]).toBe(0); // units
      expect(tail[9]).toBe(0); // reissuable
    });

    it('RESTRICTED issue payload: name keeps the $ prefix', () => {
      const data = serializeCNewAsset({
        name: '$SECURITY',
        amount: 100000000000,
        units: 0,
        reissuable: 1,
        hasIPFS: 0,
      });
      expect(data[0]).toBe('$SECURITY'.length); // 9
      expect(new TextDecoder().decode(data.slice(1, 1 + 9))).toBe('$SECURITY');
    });
  });

  // ===========================================================================
  // Parent owner-token re-transfer output (rvnt) — SUB / UNIQUE / RESTRICTED.
  // C++ CAssetTransfer(parentOwner!, OWNER_ASSET_AMOUNT) back to the issuer
  // (src/assets/assets.cpp:3987-3990, 4036-4040). OWNER_ASSET_AMOUNT = 1*COIN.
  // STATUS: C++-verified-by-construction.
  // ===========================================================================
  describe('parent owner-token re-transfer (rvnt)', () => {
    it('serializes CAssetTransfer(PARENT!, 1*COIN) with empty message', () => {
      const t = serializeCAssetTransfer({
        name: 'PARENT!',
        amount: OWNER_ASSET_AMOUNT,
        message: '',
      });
      // strName: 07 + "PARENT!", amount(8) 100000000 LE. The empty message emits
      // NOTHING (daemon-byte-identical), so there is no trailing 0x00 length byte.
      expect(t[0]).toBe('PARENT!'.length); // 7
      expect(new TextDecoder().decode(t.slice(1, 1 + 7))).toBe('PARENT!');
      expect(hex(t.slice(8, 16))).toBe('00e1f50500000000'); // amount LE
      expect(t.length).toBe(1 + 7 + 8); // name(8) + amount(8), no empty-message byte
    });

    it('rvnt magic is r,v,n,t', () => {
      expect(hex(MAGIC_ASSET_TRANSFER)).toBe('72766e74');
    });
  });

  describe('OWNER_ASSET_AMOUNT constant', () => {
    it('equals 1 * COIN (100000000 satoshis)', () => {
      expect(OWNER_ASSET_AMOUNT).toBe(100000000);
    });
  });
});
