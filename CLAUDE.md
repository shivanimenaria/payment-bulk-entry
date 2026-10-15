# PBE (Bulk Vendor Payment Entry) App

## Project Overview
Standalone web app for recording one vendor payment and allocating it across multiple rDash payment requests in a single submit. Deployed on Azure AKS, embedded inside rDash at **Manage Vendor → <vendor> → Vendor Payments → Bulk Payment sub-tab** (next to "Payment Entries"; slug **TBD** with rDash). Styled like rDash (see "UI Layout").

The view is **vendor-level and cross-project**: the app shows the vendor it was opened for (from the rDash iframe URL — there is **no vendor dropdown anywhere**) and that vendor's payment requests across **all projects**. The user enters the amount paid, allocates it manually across requests, and submits through the rDash bulk payment API.

Reference implementation for embedding/auth: the **RFQ app** at `/Users/shivanimenaria/Downloads/RFQ-master 2` (see its `CLAUDE.md` and `docs/rdash-embedding-integration.md`). Copy patterns from it; **never modify it**.

## Tech Stack
- **Framework**: Next.js 14.2.35 (App Router) + TypeScript 5, React 18, Node 20
- **DB**: PostgreSQL via `pg` — only for the rDash session/refresh cache (no business data)
- **UI**: Tailwind v3 + shadcn/ui (Radix), lucide-react, Gilroy font
- **Auth**: rDash embedded handover (one-time code → JWT access/refresh, encrypted session cookie) via `jose`
- **IDs**: `hashids` (rDash per-app salt)
- **Tests**: vitest (`tests/`)
- **Deploy**: Docker (standalone Next.js) → Azure ACR → AKS via GitHub Actions

## Payment Workflow
```
Open Bulk Payment sub-tab (vendor_id from iframe URL) → /payments (list) → + New Payment
→ Load vendor's payment requests across all projects (config + details)
→ Enter Amount Paid + header fields → Allocate per row (Payment Done / Pay in Full)
→ Excess must be 0 → Submit (bulk API) → Show created / failed → Refresh requests
```

## UI Layout
```
Bulk payment entry                                              Currency: INR
[Amount paid*] [Payment date*] [Payment mode*]
[Reference / UTR] [Remark]
[Total due] [Amount paid] [Allocated] [Excess]                  ← summary cards
Payment due · N of M selected                     [Clear applied amount]
S.No | Request Date | Request ID | Project Name | Request Type | Due Date | Requested By |
Status | Requested Amount | Payment Due | Payment Done [input + Pay in full] | Remarks [input]
[Submit payments] [Cancel]
Result panel (created / failed) below
```
- rDash look: white surfaces, thin grey borders, red primary `#E53935`, Gilroy, compact table, left icon sidebar like rDash.
- Wide table scrolls horizontally inside its own container; header and summary stay visible.
- No vendor field: the vendor is fixed by the iframe URL / session.

### Key Rules
- **Header**: Amount Paid*, Payment Date*, Payment Mode* (`bank_transfer | cheque | cash | upi`), Reference/UTR, Remark.
- **Summary cards**: Total Due, Amount Paid, Allocated (sum of Payment Done), Excess = Paid − Allocated (highlighted when ≠ 0).
- **Payment Done** (row input): the amount being paid now for that request; **Pay in Full** sets it to Payment Due; **Clear applied amount** resets all rows.
- **Remarks** (row input):
  - The header Remark is copied into every row's Remarks.
  - If the user edits a row's Remarks, that row is marked overridden and **its value wins**; later header Remark changes do NOT overwrite overridden rows.
  - Clearing an overridden row's Remarks keeps it overridden (empty = no remark for that row).
  - Each entry's `remark` = that row's Remarks (`null` if empty).
- `payment_date`, `payment_mode` and `transaction_id` come from the header for every entry (no per-row payment date).
- Submit only when Excess = 0 and there are no validation errors.
- Payment Done: number, `≤ payment_due`, max 2 decimals; only rows with `amount > 0` are sent.
- Only requests with `payment_due > 0` are shown (payable `status` values **TBD**).
- Validation runs on client **and** server (shared `lib/payments/validation.ts`).
- **Vendor = session vendor.** `api/rdash/payment-requests` and `api/rdash/payment-entries/bulk` use `auth.vendorId` from the session and ignore any vendor id sent by the client (query or body) — never read, compared or forwarded.
- **Server never trusts client payment data.** The bulk route re-fetches the session vendor's config (all pages, user's token) and validates every row against it: `payment_request_id` must be in the fresh list, unique within the submission, `payment_due > 0`, and `amount ≤` the **server-fetched** `payment_due`. Client-sent `payment_due` / amounts-due are ignored. Any invalid, duplicate or unknown row rejects the whole submission (400) before the bulk API is called.
- Submit is single-flight — in-flight guard + disabled button; no duplicate submissions.
- **Partial failure**: show "₹X recorded, ₹Y NOT recorded"; failed rows keep their amounts and remarks; **Retry failed** resends ONLY failed entries; Amount Paid becomes the not-recorded amount.
- Table refetches after every submit.
- **Not in PBE**: vendor selector, per-row payment date, paid-through account, drafts, refunds, vendor advance/excess, transaction proof upload (v1 → `transaction_proof_*` = `null`).

## Embedding & Session (handover-only)
Same pattern as RFQ, plus vendor.

1. rDash opens the iframe at `/embedded/bootstrap?vendor_id=<hashid>&org_id=<hashid>&user_id=<hashid>` (`project_id` optional). All IDs are encoded with the PBE per-app salt.
2. Bootstrap posts `rdash_iframe_ready` to the parent; rDash replies `rdash_handover { code }` (origin checked against `NEXT_PUBLIC_RDASH_UI_ORIGIN`).
3. Bootstrap redirects to `/api/session?handover=<code>&next=…&vendor_id=…&org_id=…` (built by `lib/embedded-bootstrap-url.ts`).
4. `/api/session`:
   - Missing `vendor_id` → `error=missing_vendor` (checked **before** consuming the code).
   - Consumes the code via `POST /api/v1/auth/embedded/handover/consume/` (JWT client_assertion). Missing `expires_in` / `refresh_token_expires_in` → `AuthError` → `session_error` (never defaulted).
   - Real mode: `app_slug` must equal `RDASH_PBE_TAB_CODE`; missing or different → `error=session_error`. Mock mode skips this check.
   - `orgId` comes **only** from the handover response (`org.id`). A URL `org_id` that differs → `error=org_mismatch`.
   - Verifies the vendor with the **new** token via `assertVendorInOrg()` (`/v2/vendors`, `noRefresh`). Not found / undecodable → `error=vendor_not_found`; rDash 403 → `error=vendor_forbidden`.
   - On success sets the encrypted cookie (`pbe-auth`) and redirects to `/payments?orgId=…&projectId=…&userId=…&vendorId=…`.
   - No cookie is set on any error. Error redirects carry only a fixed code; details go to the server log.
   - Error redirects are cached 5 min per handover code so a replayed URL can't re-consume it; generic `session_error` is not cached.
5. Bootstrap shows a fixed message per error code (`BOOTSTRAP_ERROR_MESSAGES`), e.g. missing_vendor → "Please open Bulk Payment from a vendor's Vendor Payments page."
6. Bootstrap's `/api/auth/me` probe sends the URL org/user/vendor/project context, so middleware can detect a cookie for a different vendor/org/user.
7. `force=1` recovery (api-fetch 401): bootstrap reads the vendor from `next` (`vendorId`) as well as the URL; no vendor → `missing_vendor`, never a fallback to the cookie's vendor.

Handover returns: `access_token` (~15 min), `refresh_token` (~12 h), `user {id, display_name, email}`, `org {id, name, type}`, `app_slug`. It does **not** return vendor or project — `vendor_id` comes from the iframe URL and is verified server-side against `/v2/vendors`.

Session cookie payload: `accessToken`, `refreshToken`, `expiresAt`, `refreshExpiresAt`, `orgId`, `projectId` (optional), `userId`, `vendorId`, `displayName`, `email` (`null` when rDash omits it), `tabCode` (`app_slug`; `null` only in mock mode), `lastPath`.

Refresh: lazy — on rDash 401, refresh once via `/api/v1/auth/token/` and retry. Concurrent refreshes are serialized (in-process single-flight + Postgres advisory lock + `pbe_user_sessions` cache) because rDash refresh tokens are single-use and a replay revokes the session. `paginateRdash(..., { noRefresh: true })` is used when the token is not the request cookie's token (e.g. vendor verification in `/api/session`), so a 401 there never refreshes the previous session. A refresh response without `refresh_token`, `expires_in` or `refresh_token_expires_in` → `AuthError` + cookie cleared (the old refresh token is never reused; lifetimes are never defaulted).

Cookie: `HttpOnly; Secure; SameSite=None`, emitted both Partitioned and unpartitioned (CHIPS), same as RFQ; dev (`http://localhost`) uses a single `SameSite=Lax` cookie. The lazy-refresh path never uses `cookies().set()` (Next keeps one cookie per name and collapses dual-emits): it queues the rotated cookie and **`withAuthCookies(handler)`** writes the pair onto the route's response. Every route that can refresh (calls `apiFetch` / `paginateRdash` / `rdashFetchWithRetry` / `refreshAuthForRequest`) **must** be wrapped — enforced by `tests/auth-cookie-sink-coverage.test.ts`.

All rDash calls use the **logged-in user's** token → payments are attributed to that user and rDash `CAN_*` permissions apply.

### Security invariants
- `orgId` and `userId` come only from the handover response — never from a URL or client body.
- `vendorId` comes from the iframe URL, is verified server-side in `/api/session`, and is never rewritten from a URL afterwards.
- Middleware: a URL org, vendor or user that differs from the cookie **clears** the cookie (forces a fresh handover). Only `projectId` is synced from the URL.
- `getAuth` / `getAuthFromCookies` refuse a URL **org or vendor** that differs from the session, and a session with no vendor.
- `x-pbe-auth-fresh` is internal: middleware strips any client-supplied value on every exit and only sets it on its own rewrite path. Every route that calls `getAuth()` is inside the middleware matcher (`tests/middleware-coverage.test.ts`).
- `COOKIE_SECRET` must be set (64 hex chars) — fail closed, never a default key.
- Mock auth only runs in explicit mock mode (see "Data Source Mode"); real auth failure never falls back to mock.
- `/api/auth/me` never returns tokens.

## Architecture
```
pbe2/
├── src/
│   ├── middleware.ts                   # URL ↔ cookie: project sync; org/vendor/user mismatch → clear
│   ├── app/
│   │   ├── embedded/bootstrap/         # postMessage handover handshake + error messages
│   │   ├── payments/                   # List page (+ New Payment)
│   │   │   └── new/                    # Payment form + allocation table
│   │   │       └── components/         # PaymentHeader, SummaryCards, AllocationTable, AllocationRow, SubmitResult, PayloadPreview, EmptyState
│   │   └── api/
│   │       ├── session/                # Handover consume, org/vendor verification, cookie, redirect
│   │       ├── auth/{me,logout}/       # Session introspection / logout
│   │       ├── health/                 # K8s health
│   │       └── rdash/                  # Server-side rDash proxies (BFF)
│   │           ├── projects/
│   │           ├── payment-requests/
│   │           └── payment-entries/bulk/
│   ├── components/{ui,embedded}/
│   ├── lib/
│   │   ├── payments/                   # validation.ts, totals.ts, build-payload.ts, retry.ts (pure, shared)
│   │   ├── server/                     # `import "server-only"`
│   │   │   ├── api.ts                  # apiFetch, paginateRdash (noRefresh), retry, assertVendorInOrg; errors: RdashPermissionError, VendorNotFoundError, RdashUpstreamError, RdashResponseShapeError, RdashIdDecodeError
│   │   │   ├── auth.ts                 # Handover, JWT cookie, refresh, getAuth, withAuthCookies (AuthPayload incl. vendorId)
│   │   │   ├── db.ts                   # PG pool, query, transactions
│   │   │   ├── rdash-id.ts             # rDash hashid encode/decode
│   │   │   ├── respond-safe.ts
│   │   │   └── rdash-source/           # index.ts (getRdashSource), mode.ts (getDataSource), types.ts (RdashSource), real.ts, mock.ts, allocation-rows.ts (config+details merge), mock-data/
│   │   ├── embedded-bootstrap-url.ts   # Pure bootstrap URL helpers + BOOTSTRAP_ERROR_MESSAGES (unit tested)
│   │   ├── api-fetch.ts                # Client fetch wrapper (401 → /embedded/bootstrap?force=1)
│   │   ├── auth-context.tsx            # Client SessionProvider + useSession + buildUrl (carries vendorId)
│   │   ├── embedded-parent-origin.ts
│   │   └── utils.ts
│   └── types/{rdash,payments}.ts
├── tests/                              # vitest: helpers.ts, middleware-coverage, auth-cookie-sink-coverage, vendor-context, refresh, payments
├── db/migrations/                      # 001_pbe_user_sessions.sql
├── k8s/{dev,prod}/
├── .github/workflows/                  # deploy-dev.yml, deploy-prod.yml
├── docs/api-notes.md                   # Every unverified rDash assumption (each marked TODO(verify) in code)
├── Dockerfile
└── docker-compose.yml
```

## Database Schema
Single table — no business data is stored; all payment data lives in rDash.

| Table | Purpose |
|-------|---------|
| `pbe_user_sessions` | rDash token cache keyed by `user_id` (`access_token`, `refresh_token`, `expires_at`, `refresh_expires_at`, `prior_refresh_token`, `updated_at`). Same shape as RFQ migration 025. |

## rDash API Endpoints (consumed)
Base: `RDASH_API_URL`. List endpoints **must** go through `paginateRdash` — never single-page.

| Endpoint | Purpose | Required Permission |
|---|---|---|
| `POST /api/v1/auth/embedded/handover/consume/` | Handover code → tokens | client_assertion (JWT) |
| `POST /api/v1/auth/token/` | Refresh | refresh_token grant |
| `GET /v2/vendors` | Server-side vendor verification only (`assertVendorInOrg`) — never shown as a dropdown | `CAN_ACCESS_MANAGE_VENDOR` (per RFQ docs; **verify**) |
| `GET /v2/projects` | Project names for the Project Name column | auth-only |
| `GET /v2/vendor-payment-requests/config/?vendor_id&limit&offset&payment_request_ids` | Vendor's payment requests (all projects) + amounts | **TBD** |
| `GET /v2/projects/{pid}/vendor-payment-requests/{payment_request_id}` | Request details for table columns | **TBD** |
| `POST /v2/vendor-payment-requests/payment-entries/bulk/` | Create payment entries | **TBD** |

### Response fields (Swagger — only these exist; never invent fields)
- **Vendors**: `id, name, code`
- **Projects**: `id, job_id, name, created_at, is_archived, is_deleted`
- **Config** (`PaginatedVendorPaymentRequestConfigOutputEntity`): `count`, `data[]` → `payment_request_id, status, request_amount, paid_amount, payment_due, currency{}`
- **Details** (`PaymentRequestDetailsOutputEntity`): `id, request_id?, request_number?, vendor{id,name}, client{id,name}, request_type, requested_by, requested_at, invoice?{id,number}, purchase_order?{id,number}, request_amount_without_tax, tax_amount, total_request_amount, paid_till_date, payment_due, remark?, due_date?, request_status, attachments[]`
- **Bulk input** (`ExternalBulkPaymentEntryCreateInputEntity`): `entries[]` → `payment_request_id*, amount*, payment_mode*, payment_date*, transaction_id?, transaction_proof_file_url?, transaction_proof_file_name?, remark?`
- **Bulk output** (`BulkPaymentEntryCreateOutputEntity`): `count, created[]{id, payment_request_id}, failed[]{payment_request_id, error}`

### Cross-project gap
Config is vendor-scoped and does **not** return `project_id`, but the details API requires `project_id` in the path. Until rDash adds `project_id` (+ project name) to the config response:
- Rows without `project_id` are marked `detailsUnavailable` — no details call, no guessing, no default project.
- Their Request Date / Request ID / Project Name / Request Type / Due Date / Requested By show "Details pending" and the Payment Done input is disabled.
- `project_id` on config items is typed optional with `TODO(verify)`.

### Allocation table → source
| Column | Source |
|---|---|
| S.No | UI row index |
| Request Date | details `requested_at` |
| Request ID | details `request_number` (or `request_id` — **TBD** which one rDash shows) |
| Project Name | config `project_id` (**requested from rDash**) → name via `GET /v2/projects` |
| Request Type | details `request_type` |
| Due Date | details `due_date` |
| Requested By | details `requested_by` |
| Status | config `status` |
| Requested Amount | config `request_amount` |
| Payment Due | config `payment_due` |
| Payment Done | entry `amount` (user input, Pay in Full) |
| Remarks | entry `remark` (header Remark, row override wins) |

Null values render as `—`. Never substitute defaults.

### Error surfacing
Same as RFQ: rDash 403 → `RdashPermissionError` → `{ "error": "You do not have access to perform this action" }` at HTTP 403. 401 that can't be refreshed → clear cookie → re-handover. Every auth 401 body is the fixed `{ "error": "Not authenticated" }` (`authErrorResponse`); the reason goes to `console.error`. rDash error bodies/messages never become client text: non-2xx or `success: false` → `RdashUpstreamError` ("rDash request failed"), unexpected list shape → `RdashResponseShapeError`, undecodable id → `RdashIdDecodeError` (never an empty list, never a raw id). Other upstream errors → 502 with a generic message + detailed `console.error`. Never return fake empty arrays on error. A failed details call marks that row with an error — never silently dropped.

## API Routes (this app)
### Auth / Session / Utility
| Route | Method | Description |
|---|---|---|
| `/api/session` | GET | Consume handover, verify org + vendor, set cookie, redirect to `/payments`; errors → `/embedded/bootstrap?error=<code>` |
| `/api/auth/me` | GET | Session info (encoded org/project/user/vendor ids, displayName, dataSource); never tokens; 2-s dedupe cache |
| `/api/auth/logout` | POST | Clear cookie + session cache (called by `EmbeddedLogoutListener`) |
| `/api/health` | GET | K8s health probe |

### rDash proxies (cookie-authenticated)
| Route | Method | Description |
|---|---|---|
| `/api/rdash/projects` | GET | Project id → name map — fully paginated |
| `/api/rdash/payment-requests` | GET | Uses session `vendorId` (no vendor param). Config (all pages) + details (parallel, concurrency 5, only rows with `project_id`) → merged allocation rows |
| `/api/rdash/payment-entries/bulk` | POST | Body `{ header, rows }` → re-fetch config for session vendor → server validation → build payload → bulk create → `{ count, created, failed, recordedAmount, notRecordedAmount }` |

All three are wrapped in `withAuthCookies`, use `getSessionOrMock` and map errors via `lib/server/route-errors.ts` (401 / 403 fixed message / 502 generic). Bulk details:
- Body `{ header, rows: [{ payment_request_id, amount, remark }] }`; only those fields are read. A vendor id in the body is ignored; a vendor id in the **query** that differs from the session makes `getAuth` refuse the request (401).
- Validation (`lib/payments/validation.ts`, money in integer paise) → `400 { error: "Validation failed", fieldErrors: { form[], header{}, rows{ [index]: { field: msg } } } }`; the bulk API is not called.
- If rDash's `created` + `failed` don't cover every submitted id exactly once → `502` ("Could not confirm which payments were recorded…"): nothing is reported as "not recorded", so a retry can't pay twice.
- `lib/payments/validation.ts` / `build-payload.ts` are **minimal versions** (server-side rules only); client wiring, `totals.ts`, `retry.ts` come with the UI step.

### Bootstrap error codes
`missing_vendor`, `vendor_not_found`, `vendor_forbidden`, `org_mismatch`, `session_error` — messages in `BOOTSTRAP_ERROR_MESSAGES` (`lib/embedded-bootstrap-url.ts`). Unknown codes show the generic message.

## Data Source Mode
- `RDASH_DATA_SOURCE=mock|real` — **required**; a missing or invalid value throws.
- `mock`: data from `rdash-source/mock-data/*.json` (Swagger-shaped), auth bypassed via one explicit `getSessionOrMock()` helper that logs `[mock] auth bypassed`; mock session includes `vendorId: "mock-vendor"`; UI shows a **MOCK DATA** badge and a Payload Preview. `MOCK_FAIL_IDS` (comma list) forces bulk failures for testing. Mock bulk also fails an entry whose `amount > payment_due`; successful entries reduce `payment_due` in an in-process copy (resets on restart) so the refetch after submit reflects them.
- Mock must never run where real credentials are configured; real auth failure never falls back to mock.
- `real`: rDash APIs with the user's session token.

## Deployment

### CI/CD
- GitHub Actions on push to `main` (paths: `src/`, `public/`, `db/`, `Dockerfile`, `package.json`).
- Pipeline: lint → type-check → test → Docker build → push ACR → deploy AKS.

### K8s
- Namespaces `pbe-dev` / `pbe-prod`. Probes hit `/api/health`.
- Secrets: `pbe-db-credentials`, `pbe-app-config`.
- Manifests set `RDASH_DATA_SOURCE=real` explicitly.
- CSP `frame-ancestors` allows only the rDash UI origin; no `X-Frame-Options: DENY`.

### Environment
| Variable | When | Description |
|---|---|---|
| `DATABASE_URL` | Runtime | Postgres connection (session cache) |
| `RDASH_API_URL` | Runtime | rDash API base |
| `RDASH_APP_URL` | Runtime | rDash web app URL |
| `RDASH_PBE_TAB_CODE` | Runtime | Embedded tab slug; must equal the handover `app_slug`. Required when `RDASH_DATA_SOURCE=real` (startup fails without it); not used in mock mode |
| `RDASH_CLIENT_ID` / `RDASH_CLIENT_KID` / `RDASH_CLIENT_ALG` / `RDASH_CLIENT_PRIVATE_KEY_PEM` | Runtime | Handover client_assertion JWT |
| `EMBEDDED_APPS_HASH_ID_SALT_PBE` | Runtime | rDash hashid salt for this app |
| `COOKIE_SECRET` | Runtime | 64 hex chars, unique to PBE (required) |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | Both | App public URL |
| `NEXT_PUBLIC_RDASH_UI_ORIGIN` | Both | postMessage origin allow-list |
| `RDASH_DATA_SOURCE` | Runtime | `mock` or `real` (required) |
| `MOCK_FAIL_IDS` | Runtime | Mock only — payment_request_ids to force-fail |

## Conventions
- Server-only modules under `src/lib/server/` with `import "server-only"` guard.
- Browser calls only `/api/*`; no token, secret or env value in client code.
- No hardcoded `org_id` / `project_id` / `vendor_id`. No vendor dropdown anywhere. **Exception (mock only):** the mock session's `orgId: "mock-org"`, `userId: "mock-user"`, `vendorId: "mock-vendor"` — non-numeric on purpose so they can never be encoded for a real rDash call.
- rDash IDs: decode at the boundary, re-encode just before outbound rDash calls / browser responses.
- `apiFetch()` for client API calls; `buildUrl()` for navigation (carries orgId/projectId/userId/vendorId). `apiFetch` sends requests as-is (no ids appended). **Intentional exceptions (plain `fetch`):**
  - `embedded/bootstrap/page.tsx` `/api/auth/me` probe — a 401 is the expected "no session" answer; `apiFetch`'s 401 handler would redirect back to bootstrap (loop).
  - `EmbeddedLogoutListener` — `apiFetch`'s 401 handler would start a fresh handover during logout.
  - **Not yet decided:** `lib/auth-context.tsx` `SessionProvider` still uses plain `fetch` for `/api/auth/me`. It is mounted in the root layout (so also on `/embedded/bootstrap`, where it skips the ping by pathname).
- **No silent fallbacks** — no default values for missing data, no alternate sources. Surface errors. **Intentional exception:** bootstrap posts the constant `rdash_iframe_ready` signal with `targetOrigin "*"` when the parent origin can't be detected — it carries no secret, the handover reply (with the code) is always origin-checked against `NEXT_PUBLIC_RDASH_UI_ORIGIN`, and origin detection fails in some browsers (no `ancestorOrigins`, stripped referrer).
- **Never invent API fields.** Unverified behavior is isolated, marked `TODO(verify)`, and listed in `docs/api-notes.md`.
- Generic error responses; detailed `console.error` for server logs.
- Currency INR (₹), Indian number format. Color: red primary `#E53935`. Font: Gilroy.
- Work in small steps; after each task list changed files + how to test. Ask when unclear. Don't commit unless asked.
- Never modify anything outside this repo (especially `<RFQ_PATH>`). Never touch `.env.local`.

## Commands
- `npm run dev` — dev server (port 3000)
- `npm run build` — standalone production build
- `npm run lint` — ESLint
- `npm test` — vitest
- `docker compose up --build` — local app + postgres
- `sh db/migrate.sh` — run migrations (needs `DATABASE_URL`)

## Open Items (verify with rDash team)
- **App registration**: `client_id`, `kid`, tab slug, iframe origin whitelist, hashid salt (we send the public key).
- **Iframe URL encoding**: confirm rDash encodes `vendor_id` / `org_id` / `user_id` with the PBE per-app salt, and that the sub-tab `src` is always `/embedded/bootstrap?...` (never `/api/session` directly).
- **Embedded sub-tab on the vendor page**: confirm a custom embedded app can mount under Manage Vendor → Vendor Payments.
- **Vendor in handover**: can the consume response include `vendor` so it is authoritative (instead of URL + `/v2/vendors` check)?
- **`/v2/vendors`**: org-scoped for the token? id encoding, envelope, required permission; single-vendor lookup (`/v2/vendors/{id}` or id filter) to avoid paging all vendors on every handover.
- **`project_id` (+ project name) in config response** — required for cross-project details.
- **ID equivalence**: config `payment_request_id` == details `id` == bulk `payment_request_id`? Hashids or raw?
- **Bulk authorization**: does bulk verify each `payment_request_id` belongs to the user's org/vendor?
- **Bulk body**: `{ entries }` vs `{ data: { entries } }`; max entries per call.
- **Duplicate `transaction_id`** across entries of one payment — allowed?
- **Payable statuses**: which `status` / `request_status` values can be paid.
- **Business rules**: overpay, future `payment_date`, `transaction_id` required for non-cash modes.
- **Currency object** shape; mixed currencies for one vendor (affects totals).
- **Permissions**: `CAN_*` required for config, details, bulk.
- **rdash-api logging**: confirm `X-Pbe-Referer/Origin/User-Agent/Client-Ip` are bound (only `X-Rfq-*` known).
- **Payments list page**: no API to list past payment entries yet.
- **Transaction proof upload**: no upload endpoint known — out of v1.