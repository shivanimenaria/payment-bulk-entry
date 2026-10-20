// Payable-status rule — ONE place, shared by client and server. Pure.
//
// A payment request is payable only if BOTH:
//   (a) its config `status` is one of PAYABLE_STATUSES (exact lowercase
//       string match — any other or missing status is NOT payable; never
//       guessed or case-folded), AND
//   (b) payment_due > 0. rDash sends decimal strings ("29500.0000"); a due that
//       is KNOWN to be ≤ 0 ("0", "0.0") excludes the row. A due PBE can't
//       process (too large / invalid) is NOT silently dropped: the row stays
//       visible with an error and can't take a payment (allocation.ts
//       rowAmountIssue); the server rejects it on submit.
//
// Status values = rDash PAYMENT_REQUEST_STATUS (rdash-web
// src/constants/payment-request.constants.tsx): pending, approved, rejected,
// cancelled, hold, submitted.
// TODO(verify): rDash to confirm "submitted" is payable, and that the config
// endpoint returns these exact lowercase values (docs/api-notes.md → #16).
import type { VendorPaymentRequestConfigItem } from "@/types/rdash";
import { parseRdashAmount } from "./money";

export const PAYABLE_STATUSES = ["pending", "approved", "submitted"] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export function isPayableStatus(status: unknown): status is PayableStatus {
  return typeof status === "string" && (PAYABLE_STATUSES as readonly string[]).includes(status);
}

/** false only when payment_due is known to be ≤ 0. */
export function hasPaymentDue(item: Pick<VendorPaymentRequestConfigItem, "payment_due">): boolean {
  const due = parseRdashAmount(item.payment_due);
  return due.ok ? due.units > BigInt(0) : true;
}

/** (a) payable status AND (b) payment_due > 0. */
export function isPayable(item: Pick<VendorPaymentRequestConfigItem, "status" | "payment_due">): boolean {
  return isPayableStatus(item.status) && hasPaymentDue(item);
}
