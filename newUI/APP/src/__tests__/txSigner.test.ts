/**
 * Pure-logic coverage for the local transaction signer (src/services/txSigner.ts).
 *
 * txSigner replicates the C++ legacy-P2PKH signing flow entirely in the browser:
 *   parseRawTx -> sighashLegacyP2PKH -> sign -> buildP2PKHScriptSig -> buildRawTxHex
 *
 * These tests exercise the deterministic, key-independent building blocks:
 *   - parseRawTx / buildRawTxHex round-trip (byte exact)
 *   - buildP2PKHScriptSig byte layout (push(sig+sighash) push(pubkey))
 *   - sighashLegacyP2PKH (double-SHA256, determinism, sensitivity to scriptCode,
 *     input index, and hashType — i.e. the BIP-143-predecessor legacy algorithm)
 *
 * No daemon and no wallet store are required.
 */
import { describe, it, expect } from '@jest/globals';
import { sha256 } from '@noble/hashes/sha256';
import {
  parseRawTx,
  buildRawTxHex,
  buildP2PKHScriptSig,
  sighashLegacyP2PKH,
  SIGHASH_ALL,
} from '@/services/txSigner';
import { buildRawTransaction } from '@/services/assetSerialization';

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return b;
};

// A deterministic single-input, single-output P2PKH transaction (version 2).
const TXID = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const P2PKH = '76a914' + '11'.repeat(20) + '88ac';
const RAW_1IN_1OUT = buildRawTransaction(
  [{ txid: TXID, vout: 1, sequence: 0xffffffff }],
  [{ scriptPubKey: P2PKH, valueSatoshis: 100000000 }],
  0
);

describe('txSigner', () => {
  // ===========================================================================
  // parseRawTx — decode a raw tx hex into structured fields.
  // ===========================================================================
  describe('parseRawTx', () => {
    it('parses version, inputs, outputs, and locktime', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      expect(tx.version).toBe(2);
      expect(tx.inputs.length).toBe(1);
      expect(tx.outputs.length).toBe(1);
      expect(tx.locktime).toBe(0);
    });

    it('stores the outpoint hash byte-reversed relative to the original txid', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      // buildRawTransaction reverses the txid bytes on the wire; parseRawTx reads
      // them back in wire order, so prevTxId equals the reversed display txid.
      const reversed = TXID.match(/../g)!.reverse().join('');
      expect(tx.inputs[0].prevTxId).toBe(reversed);
      expect(tx.inputs[0].vout).toBe(1);
      expect(tx.inputs[0].sequence).toBe(0xffffffff);
      // The funding input in a yet-unsigned tx carries an empty scriptSig.
      expect(tx.inputs[0].scriptSig.length).toBe(0);
    });

    it('decodes the output value as a bigint satoshi amount and the scriptPubKey', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      expect(tx.outputs[0].value).toBe(100000000n);
      expect(hex(tx.outputs[0].scriptPubKey)).toBe(P2PKH);
    });

    it('parses a multi-input / multi-output tx with a non-zero locktime', () => {
      const raw = buildRawTransaction(
        [
          { txid: TXID, vout: 0 },
          { txid: TXID, vout: 7 },
        ],
        [
          { scriptPubKey: P2PKH, valueSatoshis: 1 },
          { scriptPubKey: P2PKH, valueSatoshis: 2 },
          { scriptPubKey: P2PKH, valueSatoshis: 3 },
        ],
        500000
      );
      const tx = parseRawTx(raw);
      expect(tx.inputs.length).toBe(2);
      expect(tx.outputs.length).toBe(3);
      expect(tx.inputs[1].vout).toBe(7);
      expect(tx.outputs.map((o) => o.value)).toEqual([1n, 2n, 3n]);
      expect(tx.locktime).toBe(500000);
    });
  });

  // ===========================================================================
  // buildRawTxHex — re-serialize a ParsedTx. Round-trips with parseRawTx.
  // ===========================================================================
  describe('buildRawTxHex (round-trip with parseRawTx)', () => {
    it('re-serializes a parsed tx to byte-identical hex', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      expect(buildRawTxHex(tx)).toBe(RAW_1IN_1OUT);
    });

    it('round-trips a multi-in/out tx', () => {
      const raw = buildRawTransaction(
        [{ txid: TXID, vout: 3 }, { txid: TXID, vout: 9 }],
        [{ scriptPubKey: P2PKH, valueSatoshis: 12345 }, { scriptPubKey: P2PKH, valueSatoshis: 67890 }],
        123456
      );
      expect(buildRawTxHex(parseRawTx(raw))).toBe(raw);
    });

    it('preserves a populated scriptSig through the round-trip', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      // Inject a synthetic scriptSig and confirm it survives re-serialization.
      tx.inputs[0].scriptSig = fromHex('47' + 'aa'.repeat(71) + '21' + '02'.repeat(33));
      const re = buildRawTxHex(tx);
      const tx2 = parseRawTx(re);
      expect(hex(tx2.inputs[0].scriptSig)).toBe(hex(tx.inputs[0].scriptSig));
    });
  });

  // ===========================================================================
  // buildP2PKHScriptSig — PUSH(DERsig + sighashByte) PUSH(compressedPubkey).
  // Matches C++ scriptSig << signature << pubkey.
  // ===========================================================================
  describe('buildP2PKHScriptSig', () => {
    it('lays out push(sig+sighash) then push(pubkey) — byte exact', () => {
      const sig = new Uint8Array(70).fill(0xaa); // pretend DER signature
      const pub = new Uint8Array(33).fill(0x02); // compressed pubkey
      const ss = buildP2PKHScriptSig(sig, SIGHASH_ALL, pub);
      // 0x47 (push 71 = 70 sig + 1 sighash) + sig + 0x01 + 0x21 (push 33) + pubkey
      expect(hex(ss)).toBe('47' + 'aa'.repeat(70) + '01' + '21' + '02'.repeat(33));
      // total length = 1 + 71 + 1 + 33 = 106
      expect(ss.length).toBe(106);
    });

    it('appends the sighash byte immediately after the DER signature', () => {
      const sig = new Uint8Array(71).fill(0xbb);
      const pub = new Uint8Array(33).fill(0x03);
      const ss = buildP2PKHScriptSig(sig, SIGHASH_ALL, pub);
      // sig push length = 72 (0x48), and the byte right before the pubkey push is 0x01.
      expect(ss[0]).toBe(72); // push length includes the appended sighash byte
      expect(ss[1 + 71]).toBe(SIGHASH_ALL); // sighash byte sits at the tail of the sig push
      expect(ss[1 + 72]).toBe(33); // pubkey push length
    });

    it('uses the provided sighash type byte (not hard-coded)', () => {
      const sig = new Uint8Array(8).fill(0x01);
      const pub = new Uint8Array(33).fill(0x02);
      const ss = buildP2PKHScriptSig(sig, 0x83, pub); // SIGHASH_ANYONECANPAY|SINGLE
      expect(ss[1 + 8]).toBe(0x83);
    });
  });

  // ===========================================================================
  // sighashLegacyP2PKH — legacy (pre-segwit) signature hash.
  // The result is double-SHA256 of the tx with the target input's scriptSig
  // replaced by scriptCode, other scriptSigs empty, and a 4-byte LE hashType
  // appended. The function returns the 32-byte digest.
  // ===========================================================================
  describe('sighashLegacyP2PKH', () => {
    const scriptCode = fromHex(P2PKH);

    it('returns a 32-byte digest', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      const sh = sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      expect(sh.length).toBe(32);
    });

    it('is deterministic for the same inputs', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      const a = sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      const b = sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      expect(hex(a)).toBe(hex(b));
    });

    it('is the double-SHA256 of the preimage (verifiable by reconstructing it)', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      const sh = sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      // Reconstruct the legacy preimage for a single-input tx whose scriptSig is
      // replaced by scriptCode, then append the 4-byte LE hashType.
      // version(02000000) + 01 + reversedTxid + 01000000(vout) + scriptCodeLen + scriptCode
      //   + ffffffff(seq) + 01 + value + spkLen + spk + locktime(00000000) + hashType(01000000)
      const reversedTxid = TXID.match(/../g)!.reverse().join('');
      const scLen = (scriptCode.length).toString(16).padStart(2, '0');
      const spkLen = scLen; // same P2PKH used as the output script here
      const preimageHex =
        '02000000' + '01' + reversedTxid + '01000000' + scLen + P2PKH + 'ffffffff' +
        '01' + '00e1f50500000000' + spkLen + P2PKH + '00000000' + '01000000';
      const expected = sha256(sha256(fromHex(preimageHex)));
      expect(hex(sh)).toBe(hex(expected));
    });

    it('changes when the scriptCode changes', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      const a = sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      const otherScript = fromHex('76a914' + '99'.repeat(20) + '88ac');
      const b = sighashLegacyP2PKH(tx, 0, otherScript, SIGHASH_ALL);
      expect(hex(a)).not.toBe(hex(b));
    });

    it('changes when the hashType changes', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      const all = sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      const none = sighashLegacyP2PKH(tx, 0, scriptCode, 0x02); // SIGHASH_NONE
      expect(hex(all)).not.toBe(hex(none));
    });

    it('produces a different digest per input index in a 2-input tx', () => {
      const raw = buildRawTransaction(
        [{ txid: TXID, vout: 0 }, { txid: TXID, vout: 1 }],
        [{ scriptPubKey: P2PKH, valueSatoshis: 5 }]
      );
      const tx = parseRawTx(raw);
      const s0 = sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      const s1 = sighashLegacyP2PKH(tx, 1, scriptCode, SIGHASH_ALL);
      // Different inputs get scriptCode in different positions -> different preimages.
      expect(hex(s0)).not.toBe(hex(s1));
    });

    it('does not mutate the input ParsedTx (scriptSigs remain empty)', () => {
      const tx = parseRawTx(RAW_1IN_1OUT);
      sighashLegacyP2PKH(tx, 0, scriptCode, SIGHASH_ALL);
      // The original parsed tx must be untouched (sighash builds its own buffer).
      expect(tx.inputs[0].scriptSig.length).toBe(0);
    });
  });
});
