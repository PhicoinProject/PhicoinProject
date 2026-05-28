/**
 * Pure transaction-planning math for sendToMany.
 *
 * Extracted as a pure, exhaustively-tested function because it decides how funds are
 * spent: input selection, fee, change, and the "subtract fee from amount" / "send MAX"
 * semantics. Keeping it side-effect-free lets us unit-test every branch (the daemon's
 * testmempoolaccept is only a last-resort safety net before broadcast).
 *
 * Conventions (all integer satoshis):
 *  - Normal send: the recipient receives the full gross amount; inputs must cover
 *    gross + fee; change = inputs - gross - fee.
 *  - Subtract-fee send (single recipient, e.g. "Send MAX"): inputs cover the gross
 *    amount; the recipient receives gross - fee; change = inputs - gross. This is how a
 *    wallet can be fully emptied (gross = full balance, all inputs, change = 0).
 *  - A change output below the dust threshold is NOT emitted; that remainder is absorbed
 *    into the fee (matching Bitcoin/Ravencoin wallet behaviour).
 */

export interface SendPlanParams {
  /** Candidate input values in satoshis, in the order they should be considered. */
  inputsSat: number[];
  /** Sum of recipient output amounts in satoshis (what the user entered). */
  grossOutputSat: number;
  /** Fee rate in sat per virtual byte. */
  feeRatePerByte: number;
  /** Number of recipient outputs (excluding change). */
  outputCount: number;
  /** Subtract the fee from the recipient output (only valid for a single recipient). */
  subtractFee?: boolean;
  /** Coin control: use ALL provided inputs in order (no greedy early stop). */
  forceAllInputs?: boolean;
  /** Dust threshold in satoshis (default 546). */
  dustSat?: number;
  /** Estimated vbytes per input (default 180, matches the prior sendToMany estimate). */
  inputVbytes?: number;
  /** Estimated vbytes per output (default 34). */
  outputVbytes?: number;
}

export interface SendPlan {
  /** Number of leading inputs from inputsSat that are used. */
  selectedCount: number;
  totalInputSat: number;
  feeSat: number;
  /** Change amount in satoshis (>= dust); 0 when no change output is emitted. */
  changeSat: number;
  hasChange: boolean;
  /** Satoshis to subtract from the single recipient output (subtract-fee mode), else 0. */
  recipientDeltaSat: number;
}

/** Estimated vbytes for a tx with the given input/output counts (+1 output for change). */
function estimateVbytes(inputCount: number, outputCount: number, inputVbytes: number, outputVbytes: number): number {
  // INTENTIONAL: always budget for a change output (+1), even when the plan ends up with no
  // change. This is conservative: the fee is computed for (outputCount + 1) outputs, so the
  // actual tx (which may omit the change output, e.g. a MAX send) is never under-funded. The
  // builder (psbt.buildP2PKHTx) derives the real miner fee implicitly as sum(inputs) -
  // sum(outputs), which equals this feeSat when a change output exists, and is slightly LESS
  // generous to the recipient (the saved ~1 output of vbytes becomes extra miner fee, ~3.4e4
  // sat at the relay floor) when it doesn't — never negative, so buildP2PKHTx's change>=0
  // check can never false-throw for a plan produced here. Keeping the over-budget avoids a
  // circular fee<->change dependency.
  return inputCount * inputVbytes + (outputCount + 1) * outputVbytes;
}

/**
 * Plan a send. Throws an Error with a user-facing message on insufficient funds or a
 * dust-sized recipient output. Returns a fully-resolved plan otherwise.
 */
export function planTransaction(params: SendPlanParams): SendPlan {
  const {
    inputsSat,
    grossOutputSat,
    feeRatePerByte,
    outputCount,
    subtractFee = false,
    forceAllInputs = false,
    dustSat = 546,
    inputVbytes = 180,
    outputVbytes = 34,
  } = params;

  if (grossOutputSat <= 0) throw new Error('Output amount must be positive');
  if (subtractFee && outputCount !== 1) {
    throw new Error('Subtract-fee is only supported with a single recipient');
  }

  // ---- Input selection ----
  let totalInputSat = 0;
  let selectedCount = 0;
  if (forceAllInputs) {
    for (const v of inputsSat) {
      totalInputSat += v;
      selectedCount++;
    }
  } else {
    for (const v of inputsSat) {
      totalInputSat += v;
      selectedCount++;
      const estFee = estimateVbytes(selectedCount, outputCount, inputVbytes, outputVbytes) * feeRatePerByte;
      // Normal: cover gross + fee + room for a change output. Subtract-fee: cover gross
      // only (the fee comes out of the recipient output; change may be 0).
      const target = subtractFee ? grossOutputSat : grossOutputSat + estFee + dustSat;
      if (totalInputSat >= target) break;
    }
  }

  if (selectedCount === 0) throw new Error('No spendable inputs');

  // ---- Fee from the final input count ----
  const feeSat = Math.ceil(
    estimateVbytes(selectedCount, outputCount, inputVbytes, outputVbytes) * feeRatePerByte
  );

  if (subtractFee) {
    // Recipient receives gross - fee; inputs must cover gross; change = inputs - gross.
    const recipientReceiveSat = grossOutputSat - feeSat;
    if (recipientReceiveSat < dustSat) {
      throw new Error('Amount is too small to cover the network fee');
    }
    const changeSat = totalInputSat - grossOutputSat;
    if (changeSat < 0) {
      throw new Error(
        `Insufficient funds. Need ${((grossOutputSat - totalInputSat) / 1e8).toFixed(8)} PHI more.`
      );
    }
    const hasChange = changeSat > dustSat;
    return {
      selectedCount,
      totalInputSat,
      feeSat,
      changeSat: hasChange ? changeSat : 0,
      hasChange,
      recipientDeltaSat: feeSat,
    };
  }

  // Normal: change = inputs - gross - fee.
  const changeSat = totalInputSat - grossOutputSat - feeSat;
  if (changeSat < 0) {
    throw new Error(
      `Insufficient funds. Need ${((grossOutputSat + feeSat - totalInputSat) / 1e8).toFixed(8)} PHI more.`
    );
  }
  const hasChange = changeSat > dustSat;
  return {
    selectedCount,
    totalInputSat,
    feeSat,
    changeSat: hasChange ? changeSat : 0,
    hasChange,
    recipientDeltaSat: 0,
  };
}
