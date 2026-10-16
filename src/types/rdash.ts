// rDash API shapes. Field names are EXACTLY the Swagger fields listed in
// CLAUDE.md ("Response fields") — never add fields that aren't there.
// `?` in CLAUDE.md (optional/nullable) is typed `| null`.
//
// ID convention: payment-flow ids (project id, payment_request_id, …) are
// kept exactly as rDash returns them (opaque strings) and sent back
// unchanged; only the session vendor id is re-encoded (it is stored decoded).
//
// Money: rDash sends DECIMAL STRINGS with up to 4 decimals ("29500.0000",
// "0"). Always parse with lib/payments/money.ts parseRdashAmount — never
// Number()/parseFloat (confirmed from a real production response,
// tests/fixtures/real-config-page.json).

/** Decimal string, up to 4 decimals, e.g. "29500.0000". */
export type RdashDecimal = string;

// Standard rDash response envelope.
export interface ApiResponse<T> {
  code: number;
  message: string;
  success: boolean;
  data: T;
  errors: Record<string, string> | null;
}

// GET /v2/vendors item (Swagger: id, name, code). `id` is decoded to an
// integer-string at the server boundary.
export interface RdashVendor {
  id: string;
  name: string;
  code: string;
}

// GET /v2/projects item.
export interface RdashProject {
  id: string;
  job_id: string;
  name: string;
  created_at: string;
  is_archived: boolean;
  is_deleted: boolean;
}

// Currency object on config items (real response).
export interface RdashCurrency {
  id: string | null;
  name: string;
  symbol: string;
  code: string;
  locale?: string;
}

// GET /v2/vendor-payment-requests/config/ — PaginatedVendorPaymentRequestConfigOutputEntity
export interface VendorPaymentRequestConfigItem {
  payment_request_id: string;
  /** rDash PAYMENT_REQUEST_STATUS value (seen: approved, pending, submitted, cancelled). */
  status: string;
  request_amount: RdashDecimal;
  paid_amount: RdashDecimal;
  payment_due: RdashDecimal;
  currency: RdashCurrency;
  // Required in the corrected Swagger. Still checked at runtime: a missing
  // value → detailsUnavailable, never guessed (RDASH_TEMP_PROJECT_ID covered
  // the gap and is no longer needed — remove).
  project_id: string;
}

/** DRF pagination envelope (inside the standard `{ success, data }`). */
export interface DrfPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type PaginatedVendorPaymentRequestConfig = DrfPage<VendorPaymentRequestConfigItem>;

export interface RdashIdName {
  id: string;
  name: string;
}

export interface RdashIdNumber {
  id: string;
  number: string;
}

// GET /v2/projects/{pid}/vendor-payment-requests/{payment_request_id} — PaymentRequestDetailsOutputEntity
export interface PaymentRequestDetails {
  id: string;
  request_id: string | null;
  request_number: string | null;
  vendor: RdashIdName;
  client: RdashIdName;
  request_type: string;
  requested_by: RdashIdName | null;
  requested_at: string;
  invoice: RdashIdNumber | null;
  purchase_order: RdashIdNumber | null;
  // Swagger says number; real responses may use decimal strings — parse with
  // parseRdashAmount either way.
  request_amount_without_tax: RdashDecimal | number;
  tax_amount: RdashDecimal | number;
  total_request_amount: RdashDecimal | number;
  paid_till_date: RdashDecimal | number;
  payment_due: RdashDecimal | number;
  remark: string | null;
  due_date: string | null;
  request_status: string;
  attachments: RdashAttachment[];
}

export interface RdashAttachment {
  id: string;
  file: string;
  name: string;
  uploaded_by: RdashIdName;
  uploaded_at: string;
}

export type PaymentMode = "bank_transfer" | "cheque" | "cash" | "upi";

// POST /v2/vendor-payment-requests/payment-entries/bulk/ — ExternalBulkPaymentEntryCreateInputEntity
export interface BulkPaymentEntryInput {
  payment_request_id: string;
  /** number($float) — the validated amount, at most 2 decimals. */
  amount: number;
  payment_mode: PaymentMode;
  /** "YYYY-MM-DD" (confirmed). */
  payment_date: string;
  transaction_id: string | null;
  transaction_proof_file_url: string | null;
  transaction_proof_file_name: string | null;
  remark: string | null;
}

export interface ExternalBulkPaymentEntryCreateInput {
  entries: BulkPaymentEntryInput[];
}

// BulkPaymentEntryCreateOutputEntity
export interface BulkPaymentEntryCreated {
  id: string;
  payment_request_id: string;
}

export interface BulkPaymentEntryFailed {
  payment_request_id: string;
  error: string;
}

// Confirmed by the corrected Swagger.
export interface BulkPaymentEntryCreateOutput {
  count: number;
  created: BulkPaymentEntryCreated[];
  failed: BulkPaymentEntryFailed[];
}
