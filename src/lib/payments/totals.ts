// Summary-card totals. Pure; integer paise throughout.
import type { AllocationRow } from "@/types/payments";
import { rowAmountPaise, toPaise } from "./money";

export interface Totals {
  /** Sum of payment_due over the rows; null if any due isn't valid money (renders "—"). */
  totalDuePaise: number | null;
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
  let allocatedPaise = 0;
  let selectedCount = 0;
  let hasInvalidAmount = false;
  for (const row of rows) {
    const due = toPaise(row.config.payment_due);
    totalDuePaise = due === null || totalDuePaise === null ? null : totalDuePaise + due;
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
    amountPaidPaise,
    allocatedPaise,
    excessPaise: amountPaidPaise === null ? null : amountPaidPaise - allocatedPaise,
    selectedCount,
    hasInvalidAmount,
  };
}
