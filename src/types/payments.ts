// PBE payment-flow shapes (UI + routes). Shared by client and server.
import type {
  BulkPaymentEntryCreated,
  BulkPaymentEntryFailed,
  PaymentMode,
  PaymentRequestDetails,
  VendorPaymentRequestConfigItem,
} from "./rdash";

export type RowStatus = "idle" | "created" | "failed";

// One allocation-table row: the config item (amounts — authoritative for
// validation) + its details (display columns), kept as separate objects so
// fields both entities have (e.g. payment_due) never get mixed up.
export interface AllocationRow {
  config: VendorPaymentRequestConfigItem;
  // null when detailsUnavailable or when the details call failed.
  details: PaymentRequestDetails | null;
  // Project name from GET /v2/projects; null when unknown (renders "—").
  projectName: string | null;
  // Config item has no project_id → details not called (no guessing).
  detailsUnavailable: boolean;
  // Details call failed for this row (generic message; row is kept, not dropped).
  detailsError: string | null;

  // ── UI state ──
  // Payment Done: raw input text ("" = nothing entered); validated by
  // lib/payments/validation.ts (number, ≤ payment_due, max 2 decimals).
  amount: string;
  // Row Remarks: header Remark copied in until the user edits the row.
  remark: string;
  remarkOverridden: boolean;
  rowStatus: RowStatus;
  // Bulk failure message for this row (rowStatus "failed").
  rowError: string | null;
}

// Header form. No vendor field — the vendor is the session vendor.
export interface PaymentHeader {
  // Raw input text, validated like row amounts.
  amountPaid: string;
  // "YYYY-MM-DD"
  paymentDate: string;
  paymentMode: PaymentMode | null;
  // Reference / UTR → each entry's transaction_id.
  reference: string;
  remark: string;
}

export interface BulkSubmitResult {
  count: number;
  created: BulkPaymentEntryCreated[];
  failed: BulkPaymentEntryFailed[];
  recordedAmount: number;
  notRecordedAmount: number;
}
