# PBE (Bulk Vendor Payment Entry) App

## Project Overview
Standalone web app for recording one vendor payment and allocating it across multiple rDash payment requests in a single submit. Deployed on Azure AKS, embedded inside rDash as its **own custom tab** (slug and mount location **TBD** with rDash). UI modeled on Zoho Books "Payments Made → Bill Payment", styled like rDash.

The view is **vendor-level and cross-project**: the user selects a vendor and sees that vendor's payment requests across **all projects**, enters the amount paid, allocates it manually across requests, and submits through the rDash bulk payment API.

Reference implementation for embedding/auth: the **RFQ app** at `<RFQ_PATH>` (see its `CLAUDE.md` and `docs/rdash-embedding-integration.md`). Copy patterns from it; **never modify it**.

## Tech Stack
- **Framework**: Next.js 14.2.35 (App Router) + TypeScript 5, React 18, Node 20
- **DB**: PostgreSQL via `pg` — only for the rDash session/refresh cache (no business data)
- **UI**: Tailwind v3 + shadcn/ui (Radix), lucide-react, Gilroy font
- **Auth**: rDash embedded handover (one-time code → JWT access/refresh, encrypted session cookie) via `jose`
- **IDs**: `hashids` (rDash per-app salt)
- **Deploy**: Docker (standalone Next.js) → Azure ACR → AKS via GitHub Actions

## Payment Workflow
```
Open tab → /payments (list) → + New Payment → Select Vendor
→ Load vendor's payment requests across all projects (config + details)
→ Enter Amount Paid + header fields → Allocate per row (manual / Pay in Full)
→ Excess must be 0 → Submit (bulk API) → Show created / failed → Refresh requests
```

### Key Rules
- **Header**: Vendor*, Amount Paid*, Payment Date*, Payment Mode* (`bank_transfer | cheque | cash | upi`), Reference/UTR, Remark.
- **Allocation table**: Request Date (+ Due date below), Request #, Project, PO #, Request Amount, Amount Due, Payment Made On (per row), Payment (per row), **Pay in Full** per row, **Clear Applied Amount** above the table.
- **Summary**: Amount Paid, Amount Used (sum of row payments), Amount in Excess = Paid − Used.
- **Submit** only when Excess = 0 and there are no validation errors.
- Row amount: number, `≤ payment_due`, max 2 decimals; only rows with `amount > 0` are sent.
- Row `payment_date` auto-fills from the header date when an amount is entered; editable per row.
- Header mode / reference / remark are copied into every entry.
- Only requests with `payment_due > 0` are shown (payable `status` values **TBD**).
- Validation runs on client **and** server (shared `lib/payments/validation.ts`).
- Submit is single-flight — in-flight guard + disabled button; no duplicate submissions.
- **Partial failure**: show "₹X recorded, ₹Y NOT recorded"; failed rows keep their amounts; **Retry failed** resends ONLY failed entries; Amount Paid becomes the not-recorded amount.
- Table refetches after every submit.
- **Not in PBE**: Paid Through, Save as Draft, Amount Refunded, vendor advance/excess, transaction proof upload (v1 → `transaction_proof_*` = `null`).

## Embedding & Session (handover-only)
Same as RFQ. rDash posts a handover code to `/embedded/bootstrap` → `/api/session?handover=<code>`. The server consumes the code via `POST /api/v1/auth/embedded/handover/consume/` (JWT client_assertion), stores user/org/project/access/refresh tokens in an encrypted cookie (`pbe-auth`), and redirects to `/payments?orgId=…&projectId=…&userId=…`.

Handover returns: `access_token` (~15 min), `refresh_token` (~12 h), `user {id, display_name, email}`, `org {id, name, type}`, `app_slug`. It does **not** return `vendor_id` — that comes from the vendor dropdown.

Session cookie payload: `accessToken`, `refreshToken`, `expiresAt`, `refreshExpiresAt`, `orgId`, `projectId`, `userId`, `displayName`, `email`, `tabCode`, `lastPath`.

Refresh: lazy — on rDash 401, refresh once via `/api/v1/auth/token/` and retry. Concurrent refreshes are serialized (in-process single-flight + Postgres advisory lock + `pbe_user_sessions` cache) because rDash refresh tokens are single-use and a replay revokes the session.

Cookie: `HttpOnly; Secure; SameSite=None`, emitted both Partitioned and unpartitioned (CHIPS). `middleware.ts` keeps the cookie in sync with org/project/user in the iframe URL.

All rDash calls use the **logged-in user's** token → payments are attributed to that user and rDash `CAN_*` permissions apply.

## Architecture
```
pbe/
├── src/
│   ├── middleware.ts                   # URL ↔ cookie sync
│   ├── app/
│   │   ├── embedded/bootstrap/         # postMessage handover handshake
│   │   ├── payments/                   # List page (+ New Payment)
│   │   │   └── new/                    # Payment form + allocation table
│   │   │       └── components/         # HeaderForm, SummaryCards, AllocationTable, AllocationRow, SubmitResult, PayloadPreview, EmptyState
│   │   └── api/
│   │       ├── session/                # Handover consume + redirect
│   │       ├── auth/{me,logout}/       # Session introspection / logout
│   │       ├── health/                 # K8s health
│   │       └── rdash/                  # Server-side rDash proxies (BFF)
│   │           ├── vendors/
│   │           ├── payment-requests/
│   │           └── payment-entries/bulk/
│   ├── components/{ui,embedded}/
│   ├── lib/
│   │   ├── payments/                   # validation.ts, totals.ts, build-payload.ts, retry.ts (pure, shared)
│   │   ├── server/                     # `import "server-only"`
│   │   │   ├── api.ts                  # apiFetch, paginateRdash, retry, RdashPermissionError, /v2/vendors helpers
│   │   │   ├── auth.ts                 # Handover, JWT cookie, refresh, getAuth
│   │   │   ├── db.ts                   # PG pool, query, transactions
│   │   │   ├── rdash-id.ts             # rDash hashid encode/decode
│   │   │   ├── respond-safe.ts
│   │   │   └── rdash-source/           # index.ts (mock|real switch), types.ts, real.ts, mock.ts, mock-data/
│   │   ├── api-fetch.ts                # Client fetch wrapper
│   │   ├── auth-context.tsx            # Client SessionProvider + useSession
│   │   ├── embedded-parent-origin.ts
│   │   └── utils.ts
│   └── types/{rdash,payments}.ts
├── db/migrations/                      # 001_pbe_user_sessions.sql
├── k8s/{dev,prod}/
├── .github/workflows/                  # deploy-dev.yml, deploy-prod.yml
├── docs/api-notes.md                   # Swagger fields + verification status
├── Dockerfile
└── docker-compose.yml
```

## Database Schema
Single table — no business data is stored; all payment data lives in rDash.

| Table | Purpose |
|-------|---------|
| `pbe_user_sessions` | rDash token cache keyed by `user_id` (`access_token`, `refresh_token`, `expires_at`, `refresh_expires_at`, `prior_refresh_token`, `updated_at`). Same shape as RFQ migration 025. |

### Migrations
| File | Purpose |
|------|---------|
| 001 | `pbe_user_sessions` table |

## rDash API Endpoints (consumed)
Base: `RDASH_API_URL`. List endpoints **must** go through `paginateRdash` — never single-page.

| Endpoint | Purpose | Required Permission |
|---|---|---|
| `POST /api/v1/auth/embedded/handover/consume/` | Handover code → tokens | client_assertion (JWT) |
| `POST /api/v1/auth/token/` | Refresh | refresh_token grant |
| `GET /v2/vendors` | Vendor dropdown (org-level) | `CAN_ACCESS_MANAGE_VENDOR` (per RFQ docs) |
| `GET /v2/vendor-payment-requests/config/?vendor_id&limit&offset&payment_request_ids` | Vendor's payment requests (all projects) + amounts | **TBD** |
| `GET /v2/projects/{pid}/vendor-payment-requests/{payment_request_id}` | Request details for table columns | **TBD** |
| `POST /v2/vendor-payment-requests/payment-entries/bulk/` | Create payment entries | **TBD** |

### Response fields (Swagger — only these exist; never invent fields)
- **Vendors**: `id, name, code`
- **Config** (`PaginatedVendorPaymentRequestConfigOutputEntity`): `count`, `data[]` → `payment_request_id, status, request_amount, paid_amount, payment_due, currency{}`
- **Details** (`PaymentRequestDetailsOutputEntity`): `id, request_id?, request_number?, vendor{id,name}, client{id,name}, request_type, requested_by, requested_at, invoice?{id,number}, purchase_order?{id,number}, request_amount_without_tax, tax_amount, total_request_amount, paid_till_date, payment_due, remark?, due_date?, request_status, attachments[]`
- **Bulk input** (`ExternalBulkPaymentEntryCreateInputEntity`): `entries[]` → `payment_request_id*, amount*, payment_mode*, payment_date*, transaction_id?, transaction_proof_file_url?, transaction_proof_file_name?, remark?`
- **Bulk output** (`BulkPaymentEntryCreateOutputEntity`): `count, created[]{id, payment_request_id}, failed[]{payment_request_id, error}`

### Cross-project gap
Config is vendor-scoped and does **not** return `project_id`, but the details API requires `project_id` in the path. Until rDash adds `project_id` (+ project name) to the config response:
- Rows without `project_id` are marked `detailsUnavailable` — no details call, no guessing, no default project.
- Their Project / Request # / Request Date / PO # show "Details pending" and the amount input is disabled.
- `project_id` on config items is typed optional with `TODO(verify)`.

### Allocation table → source
| Column | Source |
|---|---|
| Request Date (+ Due date below) | details `requested_at` / `due_date` |
| Request # | details `request_number` |
| Project | config `project_id` (**requested from rDash**) → project name |
| PO # | details `purchase_order.number` |
| Request Amount | config `request_amount` |
| Amount Due | config `payment_due` |
| Payment Made On | entry `payment_date` (user input) |
| Payment | entry `amount` (user input) |

Null values render as `—`. Never substitute defaults.

### Error surfacing
Same as RFQ: rDash 403 → `RdashPermissionError` → `{ "error": "You do not have access to perform this action" }` at HTTP 403. 401 that can't be refreshed → clear cookie → re-handover. Other upstream errors → 502 with a generic message + detailed `console.error`. Never return fake empty arrays on error. A failed details call marks that row with an error — never silently dropped.

## API Routes (this app)
### Auth / Session / Utility
| Route | Method | Description |
|---|---|---|
| `/api/session` | GET | Consume handover code, set encrypted cookie, redirect to `/payments` |
| `/api/auth/me` | GET | Session user info + data-source mode for the client |
| `/api/auth/logout` | POST | Clear cookie + session cache |
| `/api/health` | GET | K8s health probe |

### rDash proxies (cookie-authenticated)
| Route | Method | Description |
|---|---|---|
| `/api/rdash/vendors?search=` | GET | Org-level vendors — fully paginated |
| `/api/rdash/payment-requests?vendor_id=` | GET | Config (all pages) + details (parallel, concurrency 5, only rows with `project_id`) → merged allocation rows |
| `/api/rdash/payment-entries/bulk` | POST | Body `{ header, rows }` → server validation → build payload → bulk create → `{ count, created, failed, recordedAmount, notRecordedAmount }` |

## Data Source Mode
- `RDASH_DATA_SOURCE=mock|real` — **required**; a missing or invalid value throws.
- `mock`: data from `rdash-source/mock-data/*.json` (Swagger-shaped), auth bypassed via one explicit `getSessionOrMock()` helper that logs `[mock] auth bypassed`, UI shows a **MOCK DATA** badge and a Payload Preview of the exact JSON that would be sent. `MOCK_FAIL_IDS` (comma list) forces bulk failures for testing.
- `real`: rDash APIs with the user's session token.
- No automatic fallback from real to mock, ever.

## Deployment

### CI/CD
- GitHub Actions on push to `main` (paths: `src/`, `public/`, `db/`, `Dockerfile`, `package.json`).
- Pipeline: lint → type-check → Docker build → push ACR → deploy AKS.

### K8s
- Namespaces `pbe-dev` / `pbe-prod`. Probes hit `/api/health`.
- Secrets: `pbe-db-credentials`, `pbe-app-config`.
- CSP `frame-ancestors` allows only the rDash UI origin; no `X-Frame-Options: DENY`.

### Environment
| Variable | When | Description |
|---|---|---|
| `DATABASE_URL` | Runtime | Postgres connection (session cache) |
| `RDASH_API_URL` | Runtime | rDash API base |
| `RDASH_APP_URL` | Runtime | rDash web app URL |
| `RDASH_PBE_TAB_CODE` | Runtime | Embedded tab slug |
| `RDASH_CLIENT_ID` / `RDASH_CLIENT_KID` / `RDASH_CLIENT_ALG` / `RDASH_CLIENT_PRIVATE_KEY_PEM` | Runtime | Handover client_assertion JWT |
| `EMBEDDED_APPS_HASH_ID_SALT_PBE` | Runtime | rDash hashid salt for this app |
| `COOKIE_SECRET` | Runtime | 64 hex chars, unique to PBE |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | Both | App public URL |
| `NEXT_PUBLIC_RDASH_UI_ORIGIN` | Both | postMessage origin allow-list |
| `RDASH_DATA_SOURCE` | Runtime | `mock` or `real` |
| `MOCK_FAIL_IDS` | Runtime | Mock only — payment_request_ids to force-fail |

## Conventions
- Server-only modules under `src/lib/server/` with `import "server-only"` guard.
- Browser calls only `/api/*`; no token, secret or env value in client code.
- No hardcoded `org_id` / `project_id` / `vendor_id`.
- rDash IDs: decode at the boundary, re-encode just before outbound rDash calls.
- `apiFetch()` for client API calls; `buildUrl()` for navigation.
- **No silent fallbacks** — no default values for missing data, no alternate sources. Surface errors.
- **Never invent API fields.** Unverified behavior is isolated, marked `TODO(verify)`, and listed in `docs/api-notes.md`.
- Generic error responses; detailed `console.error` for server logs.
- Currency INR (₹), Indian number format. Color: red primary `#E53935`. Font: Gilroy.
- Work in small steps; after each task list changed files + how to test. Ask when unclear.
- Never modify anything outside this repo (especially `<RFQ_PATH>`).

## Commands
- `npm run dev` — dev server (port 3000)
- `npm run build` — standalone production build
- `npm run lint` — ESLint
- `npm test` — payment logic tests (vitest)
- `docker compose up --build` — local app + postgres
- `sh db/migrate.sh` — run migrations (needs `DATABASE_URL`)

## Open Items (verify with rDash team)
- **App registration**: `client_id`, `kid`, tab slug, iframe origin whitelist, hashid salt (we send the public key).
- **Tab location**: org-level or project-level mount.
- **`project_id` (+ project name) in config response** — required for cross-project details.
- **ID equivalence**: config `payment_request_id` == details `id` == bulk `payment_request_id`? Are `vendor_id` / `payment_request_id` hashids?
- **Bulk body wrapper**: `{ entries }` vs `{ data: { entries } }`; max entries per call.
- **Duplicate `transaction_id`** across entries of one payment — allowed?
- **Payable statuses**: which `status` / `request_status` values can be paid.
- **Business rules**: overpay, future `payment_date`, `transaction_id` required for non-cash modes.
- **Currency object** shape; mixed currencies for one vendor (affects totals).
- **Permissions**: `CAN_*` required for config, details, bulk.
- **Payments list page**: no API to list past payment entries yet.
- **Transaction proof upload**: no upload endpoint known — out of v1.