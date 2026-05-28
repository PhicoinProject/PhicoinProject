import { describe, it, expect } from '@jest/globals';
import { planTransaction } from '@/services/sendPlanner';

// Fee model used by the planner: vbytes = inputs*180 + (outputs+1)*34, fee = ceil(vbytes*rate).
const IN = 180;
const OUT = 34;
const feeFor = (inputs: number, outputs: number, rate: number) =>
  Math.ceil((inputs * IN + (outputs + 1) * OUT) * rate);

describe('planTransaction', () => {
  describe('normal send (fee on top)', () => {
    it('selects enough inputs and computes change = inputs - gross - fee', () => {
      const rate = 1; // sat/vbyte for easy math
      const plan = planTransaction({
        inputsSat: [100_000_000],
        grossOutputSat: 10_000_000,
        feeRatePerByte: rate,
        outputCount: 1,
      });
      const fee = feeFor(1, 1, rate);
      expect(plan.selectedCount).toBe(1);
      expect(plan.feeSat).toBe(fee);
      expect(plan.recipientDeltaSat).toBe(0);
      expect(plan.changeSat).toBe(100_000_000 - 10_000_000 - fee);
      expect(plan.hasChange).toBe(true);
    });

    it('accumulates multiple inputs until the target is met', () => {
      const plan = planTransaction({
        inputsSat: [5_000_000, 5_000_000, 5_000_000],
        grossOutputSat: 9_000_000,
        feeRatePerByte: 1,
        outputCount: 1,
      });
      expect(plan.selectedCount).toBe(2); // 10,000,000 covers 9,000,000 + fee + dust
      expect(plan.totalInputSat).toBe(10_000_000);
    });

    it('throws Insufficient funds when inputs cannot cover gross + fee', () => {
      expect(() =>
        planTransaction({
          inputsSat: [1_000_000],
          grossOutputSat: 1_000_000,
          feeRatePerByte: 1000,
          outputCount: 1,
        })
      ).toThrow(/Insufficient funds/);
    });

    it('absorbs a sub-dust remainder into the fee (no change output)', () => {
      const rate = 1;
      const fee = feeFor(1, 1, rate);
      // inputs = gross + fee + 100 (100 < 546 dust) -> no change output emitted.
      const plan = planTransaction({
        inputsSat: [10_000_000 + fee + 100],
        grossOutputSat: 10_000_000,
        feeRatePerByte: rate,
        outputCount: 1,
        forceAllInputs: true,
      });
      expect(plan.hasChange).toBe(false);
      expect(plan.changeSat).toBe(0);
    });
  });

  describe('subtract-fee send (e.g. Send MAX)', () => {
    it('subtracts the fee from the single recipient output; inputs cover gross only', () => {
      const rate = 1;
      const fee = feeFor(1, 1, rate);
      // Send the FULL balance with subtract-fee: one input == gross, change must be 0.
      const balance = 50_000_000;
      const plan = planTransaction({
        inputsSat: [balance],
        grossOutputSat: balance,
        feeRatePerByte: rate,
        outputCount: 1,
        subtractFee: true,
        forceAllInputs: true,
      });
      expect(plan.feeSat).toBe(fee);
      expect(plan.recipientDeltaSat).toBe(fee); // recipient receives balance - fee
      expect(plan.changeSat).toBe(0); // inputs - gross = 0
      expect(plan.hasChange).toBe(false);
      // Conservation: input == (gross - fee) recipient + fee miner + 0 change.
      expect(plan.totalInputSat).toBe(balance - fee + fee + 0);
    });

    it('MAX across multiple inputs empties the wallet with zero change', () => {
      const rate = 1;
      const inputs = [3_000_000, 7_000_000, 1_234_567];
      const balance = inputs.reduce((a, b) => a + b, 0);
      const plan = planTransaction({
        inputsSat: inputs,
        grossOutputSat: balance,
        feeRatePerByte: rate,
        outputCount: 1,
        subtractFee: true,
        forceAllInputs: true,
      });
      expect(plan.selectedCount).toBe(3);
      expect(plan.changeSat).toBe(0);
      expect(plan.recipientDeltaSat).toBe(plan.feeSat);
    });

    it('throws when the amount cannot cover the fee (recipient would be dust)', () => {
      expect(() =>
        planTransaction({
          inputsSat: [10_000_000],
          grossOutputSat: 500, // < fee, recipient would be negative/dust
          feeRatePerByte: 1000,
          outputCount: 1,
          subtractFee: true,
        })
      ).toThrow(/too small to cover/i);
    });

    it('rejects subtract-fee with multiple recipients', () => {
      expect(() =>
        planTransaction({
          inputsSat: [10_000_000],
          grossOutputSat: 1_000_000,
          feeRatePerByte: 1,
          outputCount: 2,
          subtractFee: true,
        })
      ).toThrow(/single recipient/i);
    });
  });

  describe('coin control (forceAllInputs)', () => {
    it('uses exactly the provided inputs even if fewer would suffice', () => {
      const plan = planTransaction({
        inputsSat: [100_000_000, 100_000_000],
        grossOutputSat: 1_000_000,
        feeRatePerByte: 1,
        outputCount: 1,
        forceAllInputs: true,
      });
      expect(plan.selectedCount).toBe(2);
      expect(plan.totalInputSat).toBe(200_000_000);
    });

    it('errors if the selected inputs cannot cover gross + fee', () => {
      expect(() =>
        planTransaction({
          inputsSat: [1_000_000],
          grossOutputSat: 999_999,
          feeRatePerByte: 1000,
          outputCount: 1,
          forceAllInputs: true,
        })
      ).toThrow(/Insufficient funds/);
    });
  });

  describe('guards', () => {
    it('throws on non-positive output', () => {
      expect(() =>
        planTransaction({ inputsSat: [1], grossOutputSat: 0, feeRatePerByte: 1, outputCount: 1 })
      ).toThrow(/positive/);
    });
    it('throws on no inputs', () => {
      expect(() =>
        planTransaction({ inputsSat: [], grossOutputSat: 100, feeRatePerByte: 1, outputCount: 1 })
      ).toThrow(/Insufficient funds|No spendable/);
    });
  });
});
