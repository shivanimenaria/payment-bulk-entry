# Mock data (RDASH_DATA_SOURCE=mock)

Strict Swagger shapes (see `src/types/rdash.ts`); no extra fields.

- `projects.json`: `GET /v2/projects` items (5 projects).
- `config.mock-vendor.json`: `GET /v2/vendor-payment-requests/config/` page (`{count, data}`) for the mock session vendor `mock-vendor`. There are 6 requests across the 5 projects. Five have `payment_due` 30000, 50000, 40000, 45000, 35000 (total 200000), and `mock-pr-106` has `payment_due` 0 (fully paid; it must be hidden by the payment-requests step).
- `details.json`: one `PaymentRequestDetails` entity per request (keyed by `id`). Some have a null `request_number`, `request_id`, `due_date`, `invoice` or `remark`.

TODO(verify): `project_id` on config items is present **in mock data only**. rDash has been asked to add it, but it isn't in Swagger yet (docs/api-notes.md → #10). Real config items without it are marked `detailsUnavailable`.

The `status` / `request_status` / `request_type` values here are illustrative. The real payable status values are TBD (CLAUDE.md Open Items).
