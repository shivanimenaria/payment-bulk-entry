// Summary-card totals. Pure; integer paise throughout.
import type { AllocationRow } from "@/types/payments";
import { parseRdashAmount, rowAmountPaise, toPaise } from "./money";
import { rowAmountIssue } from "./allocation";

export interface Totals {
  /** Sum of payment_due over the processable rows (see unprocessableCount);
   *  null only if that sum itself exceeds safe integer paise (renders "—"). */
  totalDuePaise: number | null;
  /** Rows excluded from totals because an amount can't be processed
   *  (too large / invalid — lib/payments/allocation.ts rowAmountIssue). */
  unprocessableCount: number;
  /** Header Amount Paid; null while the input isn't valid money. */
  amountPaidPaise: number | null;
  /** Sum of valid row amounts (malformed inputs are excluded and flagged). */
  allocatedPaise: number;
  /** amountPaid − allocated; null while Amount Paid isn't valid. */
  excessPaise: number | null;
  /** Rows with a valid amount > 0. */
  selectedCount: number;
  /** At least one row amount is malformed (so allocated is incomplete). */
  hasInvalidAmount: boolean;
}

export function computeTotals(amountPaid: unknown, rows: AllocationRow[]): Totals {
  let totalDuePaise: number | null = 0;
  let unprocessableCount = 0;
  let allocatedPaise = 0;
  let selectedCount = 0;
  let hasInvalidAmount = false;
  for (const row of rows) {
    const due = parseRdashAmount(row.config.payment_due);
    if (!due.ok || rowAmountIssue(row)) {
      unprocessableCount++;
      continue; // can't take a payment either (isAmountEditable)
    }
    if (totalDuePaise !== null) {
      const sum: number = totalDuePaise + due.paise;
      totalDuePaise = Number.isSafeInteger(sum) ? sum : null;
    }
    const amount = rowAmountPaise(row.amount);
    if (amount === null) {
      hasInvalidAmount = true;
    } else if (amount > 0) {
      allocatedPaise += amount;
      selectedCount++;
    }
  }
  const amountPaidPaise = toPaise(amountPaid);
  return {
    totalDuePaise,
    unprocessableCount,
    amountPaidPaise,
    allocatedPaise,
    excessPaise: amountPaidPaise === null ? null : amountPaidPaise - allocatedPaise,
    selectedCount,
    hasInvalidAmount,
  };
}
