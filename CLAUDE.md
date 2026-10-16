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
Matches rDash's **Manage Vendor → Vendor Payments** screen. Sources: `docs/ui-reference/` (read-only — never modify): `rdash-web/src/styles/global-style.css`, `rdash-web/src/containers/payment-request/**`, `rdash-web/expense-icon.svg`, `screenshots/01…05`. Values not in the CSS (`RDStepper`, `RDLabel`, filter inputs, chrome) were measured from the screenshot pixels (Retina, 1 CSS px = 2 px).
```
[mock only: rDash sidebar | All Vendors/<vendor> · tabs (Vendor Payments) · Currency : INR]
[mock only: sub-tabs All Requests | … | Payment Entries | Bulk Payment Entry (active)  MOCK DATA]
┌ Amount paid* · Payment date* · Payment mode* · Reference / UTR · Remark ┐   ← white box, filter-style inputs
[▤ Total Due (n)] [▢ Amount Paid] [☰ Allocated (n)] [⚖ Excess]               ← PaymentRequestAmountCard ×4
┌ Payment due · N of M selected ═══ (stepper, active)   Clear applied amount ┐
│ S.No | Request Date | Request ID | Project Name | Request Type | Due Date | Requested By | Status |
│ ⏷    Requested Amount | Payment Due | Payment Done [input · Pay in full] | Remarks [input]
│ 1.  rows: 14px, p-20, border-b …
└ [Submit payments] [Cancel]           ← footer like "+ Create Payment Request" (49px) ┘
Fix-before-submitting list · Result panel · Payload preview (mock)
```
**Tokens** (`globals.css` `--rd-*` → Tailwind `rd.*`; shared classes in `components/rd/styles.ts`):
| Token | Value | Source |
|---|---|---|
| red (primary / danger) | `#ec2227` | `--theme-brand-color-primary` |
| text (cards) | `#344054` | `--theme-brand-color-dark-grey-blue`, `.text-344054` |
| black (table, tabs, stepper, labels) | `#000` | screenshot |
| border / row divider | `#c7c8c9` | `--theme-brand-border-color-primary` (`.border`, `.border-b`) |
| border secondary | `#e3e3e3` | `--theme-brand-border-color-secondary` |
| disabled / empty text | `#d0d5dd` | `--theme-brand-border-color-disabled-primary`, `.text-d0d5dd` |
| muted / placeholder / filter icons | `#98a2b3` | `.text-98a2b3`, screenshot |
| select chevron | `#c3c3c3` | screenshot |
| filter-input fill | `#f4f6f9` | screenshot |
| page background | `#f9fafb` | `.bg-f9fafb`, screenshot |
| count label fill | `#eaeaea` | `.payment-request-count` |
| failed-row tint | `#fff8f8` | `.bg-fff8f8` |
| status colours | approved `rgb(97 199 205)`, pending `rgb(234 146 69)`, rejected `rgb(236 67 67)`, hold `rgb(242 177 80)`, cancelled red | `--theme-brand-color-*`, `getStatusColor` |
| radius | 6px boxes (`.rounded-6`), 3px inputs/labels | CSS, screenshot |

**Typography**: Gilroy; normal text = the Gilroy *regular* file (rDash `font-regular`; our weight 400), semibold = Gilroy semibold (600). Sizes: tabs/stepper 14px (active semibold); table header labels 12px semibold; rows 14px; filter inputs 12px; card title 16px semibold; card value 20px semibold (`₹ 2,00,000`, `formatCardINR`); empty text 24px semibold; breadcrumb 17px + 18px bold (mock frame).

**Components**
- **Page**: `#f9fafb` background, 20px padding and 20px gaps; white `.border .rounded-6` boxes; no page title / currency line (rDash draws them around the iframe).
- **Header form**: white box (20px side padding); labels 12px semibold black, red `*`; inputs = rDash filter inputs: 22px tall, `#f4f6f9` fill, no border, 3px radius, 12px text, `#98a2b3` placeholder; calendar icon left for the date (`rd-date`: native picker stretched invisibly over the field), chevron right for the select (`components/rd/FilterInputs.tsx`). Invalid → 1px red ring.
- **Summary cards** (`PaymentRequestAmountCard`): `p-15`, `rounded-6`, border, min-height 84, gap 10 inside, 16px between cards; 14px black icon + 16px semibold title + grey contained count label (`#eaeaea`, 3px radius, 2×5px, 12px `#344054`); Total Due count = payable rows, Allocated count = selected rows; Excess red when ≠ 0.
- **Stepper bar** (`components/rd/RdStepper.tsx`, = `navigation-stepper-container` + RDStepper): 42px, white, inset 1px `#c7c8c9` bottom, 20px left padding, 14px items separated by 20px-tall `#c7c8c9` rules, active item semibold with a 2px red underline extending 8px past the text.
- **Table box**: stepper title row ("Payment due · N of M selected" active, "Clear applied amount" right as a 14px semibold red text link); header (white, `border-b`) 12px semibold black labels with the S.No funnel on the 22px filter line (PBE has no column filters, so that line is otherwise empty); rows 14px black, 20px vertical padding, 10px column gap, `border-b`, S.No "1." centred, amounts right-aligned regular, status as **coloured text** (rDash `getStatusColor` + title case — rDash does not use pills); row inputs in the filter style; "Pay in full" 12px red text link; footer = rDash `create-payment-request-btn` (49px, top border, white, bottom radius 6, buttons aligned with the 2nd column): Submit payments (contained red, 32px, 6px radius, 14px semibold) + Cancel (outlined red).
- **States**: loading = rDash rows loader (10 rows, `p-20`, `border-b`, MUI-style skeleton bars); empty = `NoPaymentEntry`: `ExpenseIcon` (`components/rd/ExpenseIcon.tsx`, copied from `expense-icon.svg`) 90×90 + "No payable requests to show" 24px semibold `#d0d5dd`, centred, gap 20; load error = red text + outlined Retry inside the box.
- **Result panel / validation list / payload preview**: white `.border .rounded-6` boxes, `p-15`; coloured text/icons only (approved cyan, pending orange, red).
- **Mock-only preview frame** (`components/shell/RdashPreviewFrame.tsx`, renders only when `/api/auth/me` reports `dataSource=mock`): static copy of rDash's chrome — 72px white left icon sidebar (red 39px active item), 58px header with "All Vendors/<mock vendor>" breadcrumb, check/bell icons and user pill, the Basic Details … Vendor Payments tabs (Vendor Payments active) with "Currency : INR", and a sub-tab row "All Requests | Pending Requests | Approved Requests | Payment Due | Payment Entries | Bulk Payment Entry" (Bulk Payment Entry active) holding the MOCK DATA badge. `aria-hidden`, no links or handlers. In real mode none of it renders — rDash provides it around the iframe.
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
- **Payable filter** (`lib/payments/payable.ts`, one shared rule — `PAYABLE_STATUSES`, `isPayableStatus`, `isPayable`): a request is shown only if BOTH (a) config `status` is one of `pending`, `approved`, `submitted` (exact lowercase match; any other or missing status → excluded, never guessed or case-folded) AND (b) `payment_due > 0`. Status values are rDash's `PAYMENT_REQUEST_STATUS` (pending, approved, rejected, cancelled, hold, submitted). `/api/rdash/payment-requests` drops non-payable rows **before** any details call.
- Validation runs on client **and** server with the SAME functions (`lib/payments/validation.ts`: `validateAllocation` for the form, `validateSubmission` for the route; shared `validateHeader`, `checkRowAmount`, `checkExcess`, money in integer paise via `money.ts`). Errors are field-keyed (`form` / `header` / `rows[index]`) plus a flat `summary` list.
- Rows with `detailsUnavailable` or `detailsError` cannot take an amount > 0 — **client-only** rule (`validateAllocation`); the bulk route deliberately does not check `project_id` / details. `rowError` (a previous bulk failure) does **not** block: failed rows keep their amounts for Retry failed.
- **Vendor = session vendor.** `api/rdash/payment-requests` and `api/rdash/payment-entries/bulk` use `auth.vendorId` from the session and ignore any vendor id sent by the client (query or body) — never read, compared or forwarded.
- **Server never trusts client payment data.** The bulk route re-fetches the session vendor's config (all pages, user's token) and validates every row against it: `payment_request_id` must be in the fresh list, unique within the submission, have a payable `status` (else "This payment request can't be paid in its current status"), `payment_due > 0`, and `amount ≤` the **server-fetched** `payment_due`. Client-sent `payment_due` / amounts-due are ignored. Any invalid, duplicate or unknown row rejects the whole submission (400) before the bulk API is called.
- Submit is single-flight — in-flight guard + disabled button; no duplicate submissions.
- **Partial failure**: show "₹X recorded, ₹Y NOT recorded"; failed rows keep their amounts and remarks; **Retry failed** resends ONLY failed entries; Amount Paid becomes the not-recorded amount.
- **Remove** (on a failed row): `dismissFailedRow` clears its amount + `rowError` and unlocks it (remark kept); `removeFailedId` drops it from the stored retry state so Retry failed never sends it; Amount Paid becomes what is still retryable (`retryAmountPaid`, `""` when nothing is left). The result panel keeps the reported amounts and marks the row "Removed".
- Table refetches after every submit (and after a network error — the submit may have reached rDash). `lib/payments/submit.ts` `mergeRowsAfterSubmit`: created rows → amount cleared; failed rows → keep amount + remark, `rowError`, locked; other rows keep their edits. Full success also resets the header.
- Submit responses: 200 → result panel; 400 → `fieldErrors.rows` mapped back to table rows (`mapServerRowErrors`), "Nothing was recorded"; 403 → permission message; 401 → `apiFetch` re-handover; 502 / network error / unexpected body → "Could not confirm whether the payments were recorded…" (never shown as success or as "not recorded").
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
│   │   ├── payments/                   # money.ts, validation.ts, totals.ts, remarks.ts, allocation.ts, build-payload.ts, retry.ts, submit.ts (pure, shared client+server)
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

### Response fields (corrected Swagger + a real production response — only these exist; never invent fields)
- **Vendors**: `id, name, code`
- **Projects**: `id, job_id, name, created_at, is_archived, is_deleted`
- **Config** (`PaginatedVendorPaymentRequestConfigOutputEntity`) — **DRF pagination**: `{ data: { count, next, previous, results[] } }` (real sample: `tests/fixtures/real-config-page.json`). `results[]` → `payment_request_id, project_id (required), status, request_amount, paid_amount, payment_due, currency { id: string|null, name, symbol, code, locale? }`. Paged by `paginateRdashDrf`: follow `next` until null (same origin/path as `RDASH_API_URL` only), total must equal `count`, else `RdashResponseShapeError`.
- **Money**: amounts are **decimal strings** with up to 4 decimals (`"29500.0000"`, `"0"`, `"0.0"`); details amounts may be strings or numbers. Parse ONLY with `parseRdashAmount` (`lib/payments/money.ts`): exact integer paise when digits beyond 2 decimals are zero; sub-paisa / malformed → invalid (never rounded); beyond `Number.MAX_SAFE_INTEGER` paise → too large. Such a row shows "Amount too large to process" / "Invalid amount from rDash", can't take a payment, is excluded from totals (with a note), and is rejected by the server. Display via `formatRdashAmount` (digit-string based, exact for any size). Currency symbol from `currency.symbol` (`lib/payments/currency.ts`).
- **Statuses seen**: approved, pending, submitted, cancelled.
- **Details** (`PaymentRequestDetailsOutputEntity`): `id, request_id?, request_number?, vendor{id,name}, client{id,name}, request_type, requested_by {id, name} | null, requested_at, invoice?{id,number}, purchase_order?{id,number}, request_amount_without_tax, tax_amount, total_request_amount, paid_till_date, payment_due, remark?, due_date?, request_status, attachments[] {id, file, name, uploaded_by{id,name}, uploaded_at}`
- **Bulk input** (`ExternalBulkPaymentEntryCreateInputEntity`): body **`{ entries: [...] }`** (Swagger's "data" is only the body param name; `BULK_BODY_WRAPPER = "entries"`). `entries[]` → `payment_request_id*, amount* (number, ≤ 2 decimals), payment_mode*, payment_date* ("YYYY-MM-DD"), transaction_id?, transaction_proof_file_url?, transaction_proof_file_name?, remark?`
- **Bulk output** (`BulkPaymentEntryCreateOutputEntity`, confirmed): `count, created[]{id, payment_request_id}, failed[]{payment_request_id, error}`

### Cross-project gap — resolved
Config now returns `project_id` (**required** in the corrected Swagger; present in the real response), so details are fetched for every row. Defensive behaviour kept:
- A config item without `project_id` is still marked `detailsUnavailable` — no details call, no guessing, no default project; its detail columns show "Details pending" and Payment Done is disabled.
- **`RDASH_TEMP_PROJECT_ID` is no longer needed — remove it** (code still present, marked `TODO(remove-temp-project-id)`; leave it unset). Previous behaviour: (`RDASH_TEMP_PROJECT_ID`, every use marked `TODO(remove-temp-project-id)`): when set, rows without `project_id` use that project for the details call and get `projectIdSource: "temporary"`. The UI must show "(temporary)" next to the project name, never as confirmed. Config `project_id` always wins. A details failure gives `detailsError` and the row is kept. Bulk is unaffected. Refused under `NODE_ENV=production` unless `ALLOW_TEMP_PROJECT_ID=true`, and a warning is logged on every startup while set.

### Allocation table → source
| Column | Source |
|---|---|
| S.No | UI row index |
| Request Date | details `requested_at` |
| Request ID | details `request_number` (or `request_id` — **TBD** which one rDash shows) |
| Project Name | config `project_id` (**requested from rDash**) → name via `GET /v2/projects` |
| Request Type | details `request_type` |
| Due Date | details `due_date` |
| Requested By | details `requested_by.name` (null → "—") |
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
- The 400 body also carries `summary: string[]`.
- Retry failed (`lib/payments/retry.ts`) resends only ids in `failed[]` with Amount Paid = their sum; an id in neither list is never resent.

### Bootstrap error codes
`missing_vendor`, `vendor_not_found`, `vendor_forbidden`, `org_mismatch`, `session_error` — messages in `BOOTSTRAP_ERROR_MESSAGES` (`lib/embedded-bootstrap-url.ts`). Unknown codes show the generic message.

## Data Source Mode
- `RDASH_DATA_SOURCE=mock|real` — **required**; a missing or invalid value throws.
- `mock`: data from `rdash-source/mock-data/*.json` (Swagger-shaped), auth bypassed via one explicit `getSessionOrMock()` helper that logs `[mock] auth bypassed`; mock session includes `vendorId: "mock-vendor"`; UI shows a **MOCK DATA** badge and a Payload Preview. `MOCK_FAIL_IDS` (comma list) forces bulk failures for testing. Mock bulk also fails an entry whose `amount > payment_due`; successful entries reduce `payment_due` in an in-process copy kept on `globalThis` (one store per server process — `next dev` gives each route its own module instance; resets only on restart) so the refetch after submit reflects them.
- Mock must never run where real credentials are configured; real auth failure never falls back to mock.
- `real`: rDash APIs with the user's session token.
- **DEV-only static-token mode** (`RDASH_AUTH_MODE=static_token`; testing against the real API before the embedded app is registered). Refused with `NODE_ENV=production` and requires `RDASH_DATA_SOURCE=real`; startup error if `RDASH_DEV_API_TOKEN`, `RDASH_DEV_AUTH_SCHEME`, `RDASH_DEV_VENDOR_ID` or `RDASH_API_URL` is missing (no defaults). `RDASH_DEV_*` set without the mode → error.
  - No handover/cookie: `getSessionOrMock` returns a dev session whose vendor is `RDASH_DEV_VENDOR_ID`. Every rDash call sends `Authorization: <RDASH_DEV_AUTH_SCHEME> <RDASH_DEV_API_TOKEN>`.
  - **No refresh**: an rDash 401 throws `DevTokenInvalidError` → 502 "Dev token rejected by rDash (401)." (not a 401, which would start an iframe re-handover).
  - Ids are sent to rDash **exactly as given** (no PBE-salt decode/encode); `/api/auth/me` returns them as-is plus `authMode: "static_token"`; the UI shows a **DEV — REAL DATA** badge.
  - **Writes blocked** unless `RDASH_DEV_ALLOW_WRITES=true`: the bulk route returns 403 "Writes disabled in dev static-token mode" before any rDash call.
  - The token is never logged or returned. `scripts/rdash-dump.ts` (`npx tsx --env-file=.env.local scripts/rdash-dump.ts "<vendor name>"`) prints raw JSON of `/v2/vendors?name=`, the config for `RDASH_DEV_VENDOR_ID` (all pages via `next`) and details for the first payable row; GET only (never the bulk POST), token redacted.

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
| `RDASH_AUTH_MODE` | Runtime | Unset/`handover` (normal) or `static_token` (**DEV only**, refused in production) |
| `RDASH_DEV_API_TOKEN` / `RDASH_DEV_AUTH_SCHEME` / `RDASH_DEV_VENDOR_ID` | Runtime | DEV static-token mode only: rDash token, its scheme (e.g. `Bearer`), rDash's own vendor hashid. Never committed; `.env.local` only |
| `RDASH_DEV_ALLOW_WRITES` | Runtime | DEV static-token mode only: `true` allows the bulk POST; unset = writes blocked |
| `RDASH_TEMP_PROJECT_ID` | Runtime | **No longer needed — remove** (config returns `project_id`). Leave unset |
| `ALLOW_TEMP_PROJECT_ID` | Runtime | `true` to permit `RDASH_TEMP_PROJECT_ID` under `NODE_ENV=production`; unset everywhere else |

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
- ~~`project_id` in config response~~ — **resolved** (required in the corrected Swagger). Project name still comes from `/v2/projects`.
- **Remove `RDASH_TEMP_PROJECT_ID` — config now returns `project_id`, so it is no longer needed** (and `ALLOW_TEMP_PROJECT_ID`, `projectIdSource: "temporary"`, all `TODO(remove-temp-project-id)` code; docs/api-notes.md #15).
- **ID equivalence**: config `payment_request_id` == details `id` == bulk `payment_request_id`? Hashids or raw?
- **Bulk authorization**: does bulk verify each `payment_request_id` belongs to the user's org/vendor?
- **Bulk**: body `{ entries }` resolved; still open: max entries per call, and whether a partial failure is a 2xx with `failed[]` or a 4xx.
- **Duplicate `transaction_id`** across entries of one payment — allowed?
- **Payable statuses**: now `pending` / `approved` / `submitted` (from rdash-web `PAYMENT_REQUEST_STATUS`; the constants file itself is not in `docs/ui-reference`, only components using its keys). rDash still to confirm **`submitted` is payable**, and that the config endpoint returns these exact lowercase values (docs/api-notes.md #16).
- **Business rules**: overpay, future `payment_date`, `transaction_id` required for non-cash modes.
- **Currency**: shape resolved (`{ id, name, symbol, code, locale? }`); still open: mixed currencies for one vendor (totals show "—" + "Mixed currencies" if it happens).
- **Permissions**: `CAN_*` required for config, details, bulk.
- **rdash-api logging**: confirm `X-Pbe-Referer/Origin/User-Agent/Client-Ip` are bound (only `X-Rfq-*` known).
- **Payments list page**: no API to list past payment entries yet.
- **Transaction proof upload**: no upload endpoint known — out of v1.