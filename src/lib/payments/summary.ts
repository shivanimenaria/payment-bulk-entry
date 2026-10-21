// Page-1 amount cards (like rDash's Vendor Payments cards) — the ONE place
// their definitions live. Computed server-side from the FULL config (the
// payment-requests route only sends payable rows as rows), per currency code,
// exact BigInt units (lib/payments/money.ts), returned as decimal strings.
//
// TODO(verify): confirm each definition with rDash (docs/api-notes.md #20) —
// rDash computes these server-side (useGetVendorPaymentRequestAmountsQuery);
// PBE derives them from the config fields it has:
//   Payment Requested — status ∉ {cancelled, rejected}: count, Σ request_amount
//   Payment Approved  — status = approved:               count, Σ request_amount
//   Pending Approval  — status ∈ {pending, submitted}:   count, Σ request_amount
//   Payment Due       — isPayable (payable status AND payment_due > 0): count, Σ payment_due
//   Payments Done     — status ∉ {cancelled, rejected}: Σ paid_amount, count of rows with paid_amount > 0
// Statuses are matched exactly (lowercase), like the payable filter.
// An amount that isn't valid rDash money is never summed (never guessed):
// the row still counts and `invalidAmounts` says how many amounts were skipped.
import type { VendorPaymentRequestConfigItem } from "@/types/rdash";
import { rdashUnits, unitsToDecimalString, type Units } from "./money";
import { isPayable } from "./payable";

export const SUMMARY_EXCLUDED_STATUSES = ["cancelled", "rejected"] as const;
export const SUMMARY_PENDING_STATUSES = ["pending", "submitted"] as const;

export type SummaryCardKey = "paymentRequested" | "paymentApproved" | "pendingApproval" | "paymentDue" | "paymentsDone";

/** Card order and titles on /payments (rDash order). */
export const SUMMARY_CARDS: readonly { key: SummaryCardKey; title: string }[] = [
  { key: "paymentRequested", title: "Payment Requested" },
  { key: "paymentApproved", title: "Payment Approved" },
  { key: "pendingApproval", title: "Pending Approval" },
  { key: "paymentDue", title: "Payment Due" },
  { key: "paymentsDone", title: "Payments Done" },
];

export interface SummaryFigure {
  count: number;
  /** Exact decimal string (sum of valid amounts). */
  total: string;
}

export type VendorPaymentSummary = Record<SummaryCardKey, SummaryFigure> & {
  /** Amounts skipped because they aren't valid rDash money. */
  invalidAmounts: number;
};

/** Per currency code. Config items without a currency code are left out
 *  (they can't be shown under any currency). */
export type VendorPaymentSummaries = Record<string, VendorPaymentSummary>;

const isExcluded = (status: unknown) =>
  typeof status === "string" && (SUMMARY_EXCLUDED_STATUSES as readonly string[]).includes(status);
const isPending = (status: unknown) =>
  typeof status === "string" && (SUMMARY_PENDING_STATUSES as readonly string[]).includes(status);

type Acc = Record<SummaryCardKey, { count: number; units: Units }> & { invalidAmounts: number };
const emptyAcc = (): Acc => ({
  paymentRequested: { count: 0, units: BigInt(0) },
  paymentApproved: { count: 0, units: BigInt(0) },
  pendingApproval: { count: 0, units: BigInt(0) },
  paymentDue: { count: 0, units: BigInt(0) },
  paymentsDone: { count: 0, units: BigInt(0) },
  invalidAmounts: 0,
});

export function summarizeConfig(config: VendorPaymentRequestConfigItem[]): VendorPaymentSummaries {
  const byCode = new Map<string, Acc>();
  for (const item of config) {
    const code = typeof item.currency?.code === "string" && item.currency.code ? item.currency.code : null;
    if (!code) continue;
    const acc = byCode.get(code) ?? emptyAcc();
    byCode.set(code, acc);
    const add = (key: SummaryCardKey, value: unknown, countIt = true) => {
      const u = rdashUnits(value);
      if (countIt) acc[key].count++;
      if (u === null) acc.invalidAmounts++;
      else acc[key].units += u;
      return u;
    };
    if (!isExcluded(item.status)) {
      add("paymentRequested", item.request_amount);
      const paid = rdashUnits(item.paid_amount);
      if (paid === null) acc.invalidAmounts++;
      else {
        acc.paymentsDone.units += paid;
        if (paid > BigInt(0)) acc.paymentsDone.count++;
      }
    }
    if (item.status === "approved") add("paymentApproved", item.request_amount);
    if (isPending(item.status)) add("pendingApproval", item.request_amount);
    if (isPayable(item)) add("paymentDue", item.payment_due);
  }
  const out: VendorPaymentSummaries = {};
  for (const [code, acc] of Array.from(byCode.entries())) {
    const fig = (k: SummaryCardKey): SummaryFigure => ({ count: acc[k].count, total: unitsToDecimalString(acc[k].units) });
    out[code] = {
      paymentRequested: fig("paymentRequested"),
      paymentApproved: fig("paymentApproved"),
      pendingApproval: fig("pendingApproval"),
      paymentDue: fig("paymentDue"),
      paymentsDone: fig("paymentsDone"),
      invalidAmounts: acc.invalidAmounts,
    };
  }
  return out;
}
