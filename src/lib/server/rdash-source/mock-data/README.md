# Mock data (RDASH_DATA_SOURCE=mock)

Strict Swagger shapes (see `src/types/rdash.ts`); no extra fields.

- `projects.json`: `GET /v2/projects` items (5 projects).
- `config.mock-vendor.json`: `GET /v2/vendor-payment-requests/config/` page (`{count, data}`) for the mock session vendor `mock-vendor`. There are 9 requests across the 5 projects, using real rDash `PAYMENT_REQUEST_STATUS` values:
  - **Payable** (shown): `mock-pr-101` approved 30000, `-102` pending 50000, `-103` approved 40000, `-104` submitted 45000, `-105` approved 35000. Total due 200000.
  - **Not payable** (hidden by `lib/payments/payable.ts`): `-106` approved but `payment_due` 0, `-107` rejected, `-108` cancelled, `-109` hold.
- `details.json`: one `PaymentRequestDetails` entity per request (keyed by `id`); `request_status` matches the config `status`. Some have a null `request_number`, `request_id`, `due_date`, `invoice` or `remark`.

Real rDash shapes (see `tests/fixtures/real-config-page.json`): the config is a DRF page (`count`, `next`, `previous`, `results`); amounts are decimal strings (`"30000.0000"`, `"0"`); `currency` is an object (`id`, `name`, `symbol`, `code`, `locale`); `project_id` is required; details have `requested_by` as `{ id, name }` and attachments as `{ id, file, name, uploaded_by, uploaded_at }`.

Status values are rDash's `PAYMENT_REQUEST_STATUS` (pending, approved, rejected, cancelled, hold, submitted); `request_type` values are illustrative.
