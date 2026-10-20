// Summary-card totals. Pure; exact BigInt units (0.0001) throughout.
import type { AllocationRow } from "@/types/payments";
import { parseRdashAmount, rowAmountUnits, userUnits, type Units } from "./money";
import { AMOUNT_INVALID_MESSAGE, rowAmountIssue } from "./allocation";

export interface Totals {
  /** Sum of payment_due over the rows (exact, any size). Rows with an invalid
   *  rDash amount are excluded and counted in unprocessableCount; rows whose
   *  due exceeds the bulk API limit ARE included. */
  totalDueUnits: Units;
  /** Rows excluded from totals because an rDash amount is invalid. */
  unprocessableCount: number;
  /** Header Amount Paid; null while the input isn't a valid amount. */
  amountPaidUnits: Units | null;
  /** Sum of valid row amounts (malformed inputs are excluded and flagged). */
  allocatedUnits: Units;
  /** amountPaid − allocated; null while Amount Paid isn't valid. */
  excessUnits: Units | null;
  /** Rows with a valid amount > 0. */
  selectedCount: number;
  /** At least one row amount is malformed (so allocated is incomplete). */
  hasInvalidAmount: boolean;
}

export function computeTotals(amountPaid: unknown, rows: AllocationRow[]): Totals {
  const zero = BigInt(0);
  let totalDueUnits = zero;
  let unprocessableCount = 0;
  let allocatedUnits = zero;
  let selectedCount = 0;
  let hasInvalidAmount = false;
  for (const row of rows) {
    const due = parseRdashAmount(row.config.payment_due);
    if (!due.ok || rowAmountIssue(row) === AMOUNT_INVALID_MESSAGE) {
      unprocessableCount++;
      continue;
    }
    totalDueUnits += due.units;
    const amount = rowAmountUnits(row.amount);
    if (amount === null) {
      hasInvalidAmount = true;
    } else if (amount > zero) {
      allocatedUnits += amount;
      selectedCount++;
    }
  }
  const amountPaidUnits = userUnits(amountPaid);
  return {
    totalDueUnits,
    unprocessableCount,
    amountPaidUnits,
    allocatedUnits,
    excessUnits: amountPaidUnits === null ? null : amountPaidUnits - allocatedUnits,
    selectedCount,
    hasInvalidAmount,
  };
}
