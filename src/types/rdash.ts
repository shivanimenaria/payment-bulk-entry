// rDash API shapes. Field names are EXACTLY the Swagger fields listed in
// CLAUDE.md ("Response fields") — never add fields that aren't there.
// `?` in CLAUDE.md (optional/nullable) is typed `| null`.
//
// ID convention: payment-flow ids (project id, payment_request_id, …) are
// kept exactly as rDash returns them (opaque strings) and sent back
// unchanged; only the session vendor id is re-encoded (it is stored decoded).
// TODO(verify): numeric fields are JSON numbers, not decimal strings, and
// date/time fields are ISO-8601 strings (docs/api-notes.md → #8).

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

// GET /v2/vendor-payment-requests/config/ — PaginatedVendorPaymentRequestConfigOutputEntity
export interface VendorPaymentRequestConfigItem {
  payment_request_id: string;
  status: string;
  request_amount: number;
  paid_amount: number;
  payment_due: number;
  // TODO(verify): currency object shape is not in Swagger (docs/api-notes.md → #9).
  currency: Record<string, unknown>;
  // TODO(verify): requested from rDash, not in Swagger yet. Without it the
  // details API (needs project_id in the path) can't be called for the row
  // → detailsUnavailable. Never guessed or defaulted (docs/api-notes.md → #10).
  project_id?: string;
}

export interface PaginatedVendorPaymentRequestConfig {
  count: number;
  data: VendorPaymentRequestConfigItem[];
}

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
  // TODO(verify): Swagger names the field but not its shape — assumed a
  // display string, may be a user object (docs/api-notes.md → #11).
  requested_by: string;
  requested_at: string;
  invoice: RdashIdNumber | null;
  purchase_order: RdashIdNumber | null;
  request_amount_without_tax: number;
  tax_amount: number;
  total_request_amount: number;
  paid_till_date: number;
  payment_due: number;
  remark: string | null;
  due_date: string | null;
  request_status: string;
  // TODO(verify): attachment item shape not in Swagger (docs/api-notes.md → #11).
  attachments: unknown[];
}

export type PaymentMode = "bank_transfer" | "cheque" | "cash" | "upi";

// POST /v2/vendor-payment-requests/payment-entries/bulk/ — ExternalBulkPaymentEntryCreateInputEntity
export interface BulkPaymentEntryInput {
  payment_request_id: string;
  amount: number;
  payment_mode: PaymentMode;
  // TODO(verify): date format assumed "YYYY-MM-DD" (docs/api-notes.md → #8).
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
  // TODO(verify): assumed a message string (docs/api-notes.md → #12).
  error: string;
}

export interface BulkPaymentEntryCreateOutput {
  // TODO(verify): assumed = number of created entries (docs/api-notes.md → #12).
  count: number;
  created: BulkPaymentEntryCreated[];
  failed: BulkPaymentEntryFailed[];
}
