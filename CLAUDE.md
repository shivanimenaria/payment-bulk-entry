# PBE (Bulk Vendor Payment Entry) App

## Project Overview
Standalone web app for recording one vendor payment and allocating it across multiple rDash payment requests in a single submit. Deployed on Azure AKS, embedded inside rDash at **Manage Vendor → <vendor> → Vendor Payments → Bulk Payment sub-tab** (next to "Payment Entries"; slug **TBD** with rDash). Styled like rDash (see "UI Layout").

The view is **vendor-level and cross-project**: the app shows the vendor it was opened for (from the rDash iframe URL — there is **no vendor dropdown anywhere**) and that vendor's payment requests across **all projects**. The user enters the amount paid, allocates it manually across requests, and submits through the rDash bulk payment API.

Reference implementation for embedding/auth: the **RFQ app** at `/Users/shivanimenaria/Downloads/RFQ-master 2` (see its `CLAUDE.md` and `docs/rdash-embedding-integration.md`). Copy patterns from it; **never modify it**.

## Tech Stack
- **Framework**: Next.js 14.2.35 (App Router) + TypeScript 5, React 18, Node 20
- **DB**: none — no database, no Redis. All payment data lives in rDash; the session is only the encrypted cookie
- **UI**: Tailwind v3 + shadcn/ui (Radix), lucide-react, Gilroy font
- **Auth**: rDash embedded handover (one-time code → access token in an encrypted session cookie) via `jose`. **No token refresh** — on expiry the iframe re-handovers
- **IDs**: rDash ids are opaque strings (rdash-api encodes them for the `bulk_payment` app); PBE never decodes or re-encodes them — no salt
- **Tests**: vitest (`tests/`)
- **Deploy**: Docker (standalone Next.js) → Azure ACR → AKS via GitHub Actions

## Payment Workflow
```
Open Bulk Payment sub-tab (vendor_id from iframe URL) → /payments (page 1: 5 amount cards, read-only list)
→ "+ Create Payment" → /payments/new?currency=<code> (page 2, laid out like the RFQ "Create RFQ" page)
→ Form card: Amount Paid* + Payment Date* + Payment Mode* (+ Reference/UTR, Remark); live Allocated / Excess; Total Due line
→ Allocate per row (Payment Done / Pay in Full, Remarks) — cards follow live
→ header Submit (client validation; Excess must be 0) → bulk API directly (no confirmation dialog)
→ rDash result prompt: all recorded = success · some failed = partial (failed rows) · 502 = "could not confirm"
→ OK → /payments (fresh load, dues updated); 400 / 403 / network: stay, nothing cleared
```
## UI Layout
Matches rDash's **Manage Vendor → Vendor Payments** screen. Sources: `docs/ui-reference/` (read-only — never modify): `rdash-web/src/styles/global-style.css`, `rdash-web/src/containers/payment-request/**`, `rdash-web/expense-icon.svg`, `screenshots/01…05`; the payment requests **table** copies the RFQ list table — `rfq-table/target-table.png` and the real code `rfq-table/rfq-app/RfqListClient.tsx` (~lines 640–900), `badge.tsx`, `rfq-globals.css` (brand colours still from the rDash tokens: red `#ec2227`, not RFQ's `#E53935`). Values not in the CSS (`RDStepper`, `RDLabel`, filter inputs, chrome) were measured from the screenshot pixels (Retina, 1 CSS px = 2 px).
```
[mock only: rDash sidebar | All Vendors/<vendor> · tabs (Vendor Payments)]
[mock only: sub-tabs All Requests | … | Payment Entries | Bulk Payment Entry (active)  MOCK DATA]
PAGE 1 — /payments (PaymentsListClient)
                                                            Currency : INR ▾   ← CurrencyFilter (top-right, real + mock)
[Payment Requested (n)] [Payment Approved (n)] [Pending Approval (n)] [Payment Due (n)] [Payments Done (n)]  ← 5 rDash amount cards, one row, gap 15
┌ Payment due ═══ (stepper, active) ┐
│ S.No | Request ID | Project Name | Request Date | Request Type | Due Date | Requested By | Status | Requested Amount | Payment Due   ← 11px semibold gray-700, bg gray-50
│ ⏷    | [Search]   | [Select ▾]   | [dd/mm/yyyy] | [Select ▾]   | [dd/mm/yyyy] | [Select ▾] | [Select ▾] |                    ← RFQ filter row (h-7)
│▌01   | PR-2026-0101 (semibold) | Skyline Residency Tower A (≤ 2 lines) | 04 Aug 2026 | (Invoice) | 🕒 03 Sep 2026 (red if past) | Anita Sharma | (● Approved) | ₹30,000 | ₹30,000
│  (read-only: no Payment Done / Pay in full / Remarks; ▌ = due-date accent bar)
└ + Create Payment                             Showing 21–40 of 45 [‹ Previous] [Next ›] ┘  ← footer (49px)

PAGE 2 — /payments/new (NewPaymentClient) — the RFQ "Create RFQ" page layout
┌ ←  Create Payment                                   Currency : INR ▾  [Cancel] [Submit] ┐  ← CreatePageHeader (white, h-14, border-b + shadow)
┌ Amount Paid*   │ 🕒 Payment Date*  │ Payment Mode*   │ Reference / UTR (2 cols)          ┐  ← CreatePaymentForm (RFQ form box)
│ 💬 Remark (3 cols, like Shipping Address)              │ Allocated  Auto allocate │ Excess (read-only, red ≠ 0) │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Total Due: ₹ 2,00,000 (5 payable requests)          Allocated total must equal Amount Paid │  ← status line + form-level error (after Submit)
└─────────────────────────────────────────────────────────────────────────────────────┘
┌ Payment due · N of M selected ═══                    Clear filters   Clear applied amount ┐
│ … page-1 columns … | Payment Done [h-7 input · Pay in full] | Remarks [h-7 input]
│      row errors in red under that row's Payment Done (after Submit)
└       1 with error hidden by filters · Clear filters · Errors on page 2 · Showing 21–40 of 45 [‹ Previous] [Next ›] ┘  ← no message panel

Result prompts after Submit (components/SubmitPrompt.tsx, rDash RDPrompt look — docs/ui-reference/rdash-popups/):
        ( ✓ )                              ( ! )                                ( ! )
 Payment entries recorded      Some payments could not be recorded    Could not confirm which
      successfully             [Recorded: 1 · ₹ X / Not recorded: …]   payments were recorded
 [2 payments · ₹ 80,000  [OK]] [Request ID | Project | Amount | Error]  Please check Payment Entries…
 [23 Sep 2026 · UPI · UTR-77 ] ───────────────────────────── [OK]      ───────────────────── [OK]
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

**Typography**: Gilroy; normal text = the Gilroy *regular* file (rDash `font-regular`; our weight 400), semibold = Gilroy semibold (600). Sizes: tabs/stepper 14px (active semibold); table header labels 12px semibold; rows 14px; filter inputs 12px; card title 16px semibold; card value 20px semibold (`₹ 2,00,000`, `formatCardUnits`); empty text 24px semibold; breadcrumb 17px + 18px bold (mock frame).

**Components**
- **Two pages** (shared loading + currency: `app/payments/usePaymentRequests.ts`; rules: `lib/payments/payment-form.ts`, pure):
  - **Page 1 — `/payments`** (`PaymentsListClient.tsx`, what the Bulk Payment tab opens; default after a handover): currency filter top-right (+ DEV badge; MOCK DATA in the mock frame); **five rDash Vendor Payments amount cards** in one row (`VendorSummaryCards`, gap 15, rDash `PaymentRequestAmountCard`: `p-15`, min-height 84, 14px icon + 16px semibold title + grey count label, 20px semibold "₹ 2,00,000"): Payment Requested, Payment Approved, Pending Approval, Payment Due, Payments Done — figures from the route's `summaries` for the selected currency (definitions in `lib/payments/summary.ts`, see Key Rules); the payable requests **read-only** (`AllocationTable readOnly`: S.No … Payment Due), 20 per page. Footer: red text link **"+ Create Payment"** (rDash "+ Create Payment Request", label written literally) → straight to `/payments/new?currency=<code>` (`withCurrency`, context params via `buildUrl`); disabled while loading or when the selected currency has no payable rows (`canCreatePayment`). Reloaded fresh after the Create Payment result prompt's OK (no banner — the prompt is the confirmation).
  - **Page 2 — `/payments/new`** (`new/NewPaymentClient.tsx`) — **laid out like the RFQ "Create RFQ" page** (reference: `docs/ui-reference/rfq-create/target-create-page.png`, `target-form-box.png`, `CreateRfqClient.tsx`; brand red from the rDash tokens). Reached straight from "+ Create Payment" (no popup) or opened directly; the currency comes from `?currency=` (only if it exists in the rows). **Header** (`components/CreatePageHeader.tsx`, RFQ sticky-header classes: white, `border-b border-gray-200 shadow-sm`, `px-6 h-14`; not sticky because the page doesn't scroll): left a ghost "←" icon button (`p-1.5 rounded-lg text-gray-500 hover:bg-gray-100`) + `text-lg font-bold text-gray-950` "Create Payment"; right (`gap-3`): currency filter, DEV badge (static-token mode), outlined **Cancel** (`Button variant="outline" h-9 text-xs px-4 font-semibold` — RFQ "Save as Draft") and red **Submit** (`h-9 text-xs px-4 font-semibold` brand red — RFQ "Create & Send"; spinner + disabled while sending). "←" and Cancel → `/payments`, asking "Discard entered amounts?" when anything was entered (`hasEnteredAnything`: a form field, a row amount or a row's own remark). **Form card** (`components/CreatePaymentForm.tsx`, RFQ form box: `bg-white rounded-xl border border-gray-200 shadow-sm`, `px-6 py-5`, `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-4`; labels `text-xs text-gray-500 mb-1.5` with a red-500 `*`; shadcn `Input` / `Select` `h-9 text-sm border-gray-200`, invalid `border-red-500`; errors `text-[11px] text-red-600` under the field — absolutely placed in the grid gap so the card never grows — shown **only after Submit** (then live) — `visibleFieldErrors`): row 1 **Amount Paid*** (submit limit, `isAllowedAmountInput`) · **Payment Date*** (clock icon label like "Deadline Date"; `<Input type="date">`, calendar-only like RFQ — typing / paste blocked, picker on click; value YYYY-MM-DD) · **Payment Mode*** (Radix `Select`: Bank Transfer, Cheque, Cash, UPI — required by the bulk API) · **Reference / UTR** (2 cols; → `transaction_id`); row 2 **Remark** (3 cols, like "Shipping Address"; header remark, copied to every row unless the row has its own) · **Allocated** (read-only field — RFQ locked-field look `bg-gray-50 border-gray-200 rounded-md h-9` — live "₹ 80,000 (2 selected)"; a 12px red "Auto allocate" text link sits right of its label — see Key Rules) · **Excess** (read-only, live, `text-red-600` when ≠ 0, "—" until Amount Paid is valid — `paidAndExcess`); status line under a `border-gray-100` divider (`px-6 py-2.5 text-sm`, RFQ "Order Status: Not Sent") **"Total Due: ₹ X"** (bold gray-900 value) + "(n payable requests)" in grey (+ "Excludes n requests that can't be processed" when needed); long amounts truncate with a `title` tooltip. No cards row on page 2. **Table** below (all page-1 columns + Payment Done + "Pay in full" + Remarks; filters, paging, row rules, "Errors on page N"); "Clear applied amount" sits in the table's title row (right, next to "Clear filters"); the footer holds only the pager.
- **Submit** (header button; no confirmation dialog): the existing client validation (`validateAllocation`); invalid → errors **inline** (only after Submit, then live as the user fixes them): field errors under each field, row errors under that row's Payment Done (+ "Errors on page N" / "N with errors hidden by filters · Clear filters" next to the pager), whole-submission errors (e.g. "Enter a payment for at least one request", "Allocated total must equal Amount Paid") as one small red line in the form card footer next to Total Due (`formLevelMessage`); nothing sent. **No message panel / strip** — nothing pushes the table footer. Valid → the existing `POST /api/rdash/payment-entries/bulk` directly; Submit disabled with a spinner while sending (single-flight guard — never a double POST).
- **After submit** — rDash result prompts (`components/SubmitPrompt.tsx`, built from `docs/ui-reference/rdash-popups/success-prompt` + `confirmation-prompt` with Radix Dialog + rd styles; data from `submitPromptFor` in `lib/payments/submit.ts`, lines from `tallyLine` / `paymentDetailsLine` in `lib/payments/payment-form.ts`). Shell: white paper, `rounded-[12px]`, no padding, 400px wide (560px with the failed table — TODO(verify): RDPrompt width not in the reference CSS); upper section centred, gap 12px, padding-top 35px, padding-bottom 20px (30px sides); 52px icon; title 20px Gilroy bold `#101828`. **All created** → green tick (`public/rdash/project-create-success-tick-icon.svg`, copied from the reference) + "Payment entries recorded successfully" + grey info box (`#f4f4f4`, 6px radius, 8px padding, full width): "N payments · ₹ X" (12px `#101828`) over "Payment date · Mode · Ref" (10px `#5d5d5d`; ref left out when empty) with a small red **OK** (RDButton small: 6px 18px, 12px) on the right. **Some failed** → warning icon (`public/rdash/warning-icon.svg`, our halo-style icon in brand red — TODO(verify) against RDPrompt `showIcon`) + "Some payments could not be recorded" + grey box "Recorded: N · ₹ X" / "Not recorded: M · ₹ Y" + a compact table of **only the failed rows** (Request ID, Project, Amount, Error; `max-h-[200px]` scroll) + bottom section (`border-t #d0d5dd`, 6px 30px) with OK. **502 / unexpected 200 body** → warning icon + "Could not confirm which payments were recorded" + "Please check Payment Entries in rDash before trying again." + bottom OK. OK → `/payments` (fresh load, dues updated; page-2 state and draft cleared). Focus trapped on OK; **Esc = OK**; outside click = OK on the success prompt only; while a submit is in flight (`busy`) nothing dismisses it. **No retry, no Remove.** 400 (row errors mapped onto the table) / 403 / network error → stay on page 2, nothing cleared, error in the form card's red line (400: "Nothing was recorded…", server row / field errors mapped inline); the table reloads keeping the edits (a reload failure shows in the same footer with Retry).
- **Mock payload preview** (`PayloadPreviewLink`, mock only): "Payload preview (mock)" text link in page 2's table title row → modal with the JSON — "will be sent" (valid) or "last sent".
- **Fixed-height layout** (like rDash's Vendor Payments table — only the rows scroll): `html`, `body` and the AppShell are 100% of the viewport / iframe height with **no page-level scroll**; every level below is a flex column with `min-h-0` (AppShell → RdashPreviewFrame in mock → `main` → `fieldset`). Fixed (never scroll away): currency filter row (`PageHeader`, `shrink-0`), summary cards (`shrink-0`), the table box's stepper title row, the column header row and the table footer. The table box (`TableBox`) takes all remaining height (`flex-1 min-h-0`); its body (`data-testid=table-scroll`) is the **one** scroll container for both axes (`overflow-auto`), so header and rows scroll together horizontally and columns stay aligned. The column header cells are `sticky top-0` with a solid white background and the bottom border drawn as an inset shadow (`inset 0 -1px 0 #c7c8c9`) so rows pass under it cleanly. Loading skeleton, empty state ("No payable requests to show" / "Select a currency…") and load error render **inside the scroll area under the header** (`AllocationTable placeholder`), pinned to the visible width (`sticky left-0`, `100cqw` — the scroll area is a size container) and centred in the visible height (skeleton from the top); header and footer stay visible. There is no message panel: errors are inline (form card, rows, pager); the no-currency note sits in the table footer (page 1) / form card footer (page 2). Works in the rDash iframe and a normal tab from ~600px tall (at 600px with the mock chrome the rows area is ~1 row; real rDash has no PBE chrome).
- **Stepper bar** (`components/rd/RdStepper.tsx`, = `navigation-stepper-container` + RDStepper): 42px, white, inset 1px `#c7c8c9` bottom, 20px left padding, 14px items separated by 20px-tall `#c7c8c9` rules, active item semibold with a 2px red underline extending 8px past the text.
- **Table box** (both pages; `AllocationTable.tsx` / `AllocationRow.tsx`, cell rules in `lib/payments/table-display.ts`) — **the RFQ list table**: card `bg-white rounded-xl border border-gray-200 shadow-sm`; rDash stepper title row ("Payment due", page 2 adds "· N of M selected"; right: "Clear filters" when a filter is on). `table-fixed`, explicit column widths (page 1 sums to 1316px so it fits without horizontal scroll at 1440px — the table area is ~1326px inside the rDash chrome; page 2 adds Payment Done 210 + Remarks 170 and scrolls horizontally), shadcn `Table` defaults (`text-sm`, cells `p-4 align-middle`). **Header**: one sticky `bg-gray-50` row, cells `px-2 py-2 align-top` (S.No `pl-3`), each label (`text-[11px] font-semibold tracking-wide text-gray-700`) stacked (`flex-col gap-1.5`) above its filter control — funnel under S.No (gray-400; red, filled and clickable to clear all filters when any is on), "Search" input (only) under Request ID, `<Input type="date">` (dd/mm/yyyy) under Request Date / Due Date, "Select Option" dropdowns (`components/rd/SelectOptionFilter.tsx`: `h-7 text-xs border-gray-200 rounded bg-white px-2`, grey placeholder, chevron; popover with checkboxes) under Project Name / Request Type / Requested By / Status; bottom border = inset gray-200 shadow (moves with the sticky cells); measured 70px. **Columns**: S.No (`text-xs text-gray-400`, zero-padded "01", continuing across pages and counting only shown rows) · Request ID (single line, truncated with a tooltip: `request_number` `text-sm font-semibold text-gray-900`, plain text — no hover / link styling; "—" without a number) · Project Name (own column: `text-sm` normal gray-900 — same font as Requested By — wrapping to max 2 lines with `line-clamp-2` ellipsis + the full name in a `title` tooltip; "—" without; "(temporary)" marker kept) · Request Date (`text-xs text-gray-500`, "20 May 2026") · Request Type (outline pill `Badge variant="outline"` `text-xs font-medium px-2 py-0.5`: Invoice blue, PO Advance amber, Non Order orange, any other type amber) · Due Date (RFQ Deadline: clock `h-3.5` + `text-xs`; `text-red-600 font-medium` when past, gray-500 otherwise; "—" without) · Requested By (`text-sm text-gray-700`) · Status (outline pill with a `h-1.5 w-1.5` dot: Approved green, Pending amber, Submitted blue, others grey; title case) · Requested Amount / Payment Due (right-aligned `text-sm font-semibold tabular-nums text-gray-900`, "₹92,06,000" — symbol attached, Indian grouping, decimals only when non-zero; truncated with a `title` tooltip) · page 2 only: Payment Done (RFQ input look `h-7 text-xs border-gray-200 rounded`, red ring on error) + "Pay in full" (12px red text link) and Remarks (same input). **Rows**: `border-b transition-colors hover:bg-gray-50/80` (RFQ: background only — text colours never change on hover); RFQ deadline-urgency left accent bar from the Due Date: `border-l-4 border-l-red-400` past or due today, `red-300` tomorrow, `orange-300` within 3 days. **Footer** (RFQ: `px-5 py-3 border-t border-gray-100`): page 1 "+ Create Payment" (`text-sm font-semibold` brand red, like "+ Create RFQ") left · pager right; page 2 "Clear applied amount" (same link) · pager · **Submit** (contained red, 32px, 6px radius, 14px semibold).
- **Table filters** (`lib/payments/filters.ts`, pure, + `app/payments/useFilteredPaging.ts`): client-side and **display only** — Request ID search (contains, case-insensitive), Request Date / Due Date (exact local day, like RFQ), Request Type / Requested By / Status / Project ("Select Option", options built from the loaded rows of the selected currency; several values = OR, columns = AND). They decide which rows are shown and what the pager counts (S.No renumbers the shown rows); they **never** change totals / cards, validation or what is submitted — amounts on hidden rows are kept and sent. Row indices stay global (handlers, row errors). "Clear filters" (title row) or the red funnel clears them; they reset when the currency changes; the page resets when filters change. "Errors on page N" counts shown rows; errors on hidden rows → "N with errors hidden by filters · Clear filters" next to the pager. Filtered to nothing → "No payment requests match your filters".
- **Pagination** (`lib/payments/pagination.ts`, pure; pager `TablePagination` in `AllocationTable.tsx`): 20 rows per page, client-side and **display-only** — all payable rows stay loaded, and Total Due / Allocated / Excess, validation and submit always use **all** rows of the selected currency. Footer right side: "Showing 21–40 of 45" (14px `#344054`) + Previous / Next (outlined red, disabled at the ends). Row indices stay global (index into the currency-filtered list), so S.No continues (21, 22, …), row errors and handlers are page-independent, and amounts on other pages are kept. Page resets to 1 when the currency, the data (re)load or the filters change (`pageResetKey(currency, loadSeq)` + `filtersKey` + `syncPage`; out-of-range pages are clamped). Row errors on other pages → "Errors on page 2" (12px red, each page number a link to that page).
- **States**: loading = rows loader (10 rows, `p-4`, `border-b`, MUI-style skeleton bars); empty = `NoPaymentEntry`: `ExpenseIcon` (`components/rd/ExpenseIcon.tsx`, copied from `expense-icon.svg`) 90×90 + "No payable requests to show" 24px semibold `#d0d5dd`, centred, gap 20; load error = red text + outlined Retry inside the box.
- **Mock-only preview frame** (`components/shell/RdashPreviewFrame.tsx`, renders only when `/api/auth/me` reports `dataSource=mock`): static copy of rDash's chrome — 72px white left icon sidebar (red 39px active item), 58px header with "All Vendors/<mock vendor>" breadcrumb, check/bell icons and user pill, the Basic Details … Vendor Payments tabs (Vendor Payments active) with "Currency : INR", and a sub-tab row "All Requests | Pending Requests | Approved Requests | Payment Due | Payment Entries | Bulk Payment Entry" (Bulk Payment Entry active) holding the MOCK DATA badge. `aria-hidden`, no links or handlers. In real mode none of it renders — rDash provides it around the iframe.
- **Currency filter** (`components/rd/CurrencyFilter.tsx`, rules in `lib/payments/currency.ts`): top-right "Currency : <CODE> ▾" (14px); opens a dropdown with a "Search Currency" box (matches name or code) and "<name> - <code>" options sorted by name. Exactly one currency among the payable rows → auto-selected; several → "Currency : Select" and the table shows "Select a currency to see payment requests" (no default, no guess). Only rows of the selected currency are shown, counted and totalled. Page 2: switching currency with amounts entered asks for confirmation and clears them. The selected currency is carried between the pages as `?currency=<code>`.
- **Request Type** (`formatRequestType`): `non_order` → Non Order, `po_advance` → PO Advance, `invoice` → Invoice, others Title Case; `""` / null → "—".
- **Long amounts** (up to 29 digits): amount columns are fixed width (160px, `table-fixed`) and summary-card values truncate — ellipsis with the full value in a `title` tooltip; never wrap, never break the layout.
- No vendor field: the vendor is fixed by the iframe URL / session.

### Key Rules
- **Header** (page-2 payment form): Amount Paid*, Payment Date*, Payment Mode* (`bank_transfer | cheque | cash | upi`), Reference/UTR, Remark.
- **Summary cards**: page 1 — the five vendor cards (`lib/payments/summary.ts`, the ONE place the definitions live; computed **server-side** from the FULL config per currency code, BigInt-exact, returned by `/api/rdash/payment-requests` as `summaries` because non-payable rows are not sent as rows; TODO(verify) with rDash — docs/api-notes.md #20): **Payment Requested** = status ∉ {cancelled, rejected}: count, Σ `request_amount`; **Payment Approved** = status `approved`: count, Σ `request_amount`; **Pending Approval** = status `pending` | `submitted`: count, Σ `request_amount`; **Payment Due** = payable rows (the payable filter): count, Σ `payment_due`; **Payments Done** = status ∉ {cancelled, rejected}: Σ `paid_amount`, count of rows with `paid_amount` > 0. Statuses matched exactly; invalid amounts never summed (`invalidAmounts`). Page 2 — no cards: the form card shows Allocated (sum of Payment Done, selected count) and Excess = Paid − Allocated ("—" while Amount Paid is empty/invalid, red when ≠ 0) as read-only fields, and "Total Due: ₹ X (n payable requests)" on its status line.
- **Payment Done** (row input): the amount being paid now for that request; **Pay in Full** sets it to Payment Due; **Clear applied amount** resets all rows.
- **Auto allocate** (form card, next to Allocated; `autoAllocate` / `autoAllocatePaidUnits` / `hasReplaceableAmounts` in `lib/payments/allocation.ts`, exact BigInt units): disabled with tooltip "Enter Amount Paid first" until Amount Paid is a valid amount > 0. Walks the rows in the table's **display order with the current filters, across all pages, selected currency only**; skips rows where `isAmountEditable` is false (over the bulk limit, details pending/error, locked failed rows — left untouched); each row gets min(remaining, `payment_due`) in the Pay in Full decimal form until nothing remains, later rows get "". Every other editable row (e.g. hidden by a filter) is cleared, so Allocated = exactly what was auto-allocated. Amount Paid > total due → every row in full, the rest stays as Excess. Row remarks are kept. If an editable row already has an amount it first asks "Replace the amounts already entered?" (Confirm / Cancel). Rows stay editable afterwards.
- **Remarks** (row input):
  - The header Remark (page-2 form) is copied into every row's Remarks.
  - If the user edits a row's Remarks, that row is marked overridden and **its value wins**; later header Remark changes do NOT overwrite overridden rows.
  - Clearing an overridden row's Remarks keeps it overridden (empty = no remark for that row).
  - Each entry's `remark` = that row's Remarks (`null` if empty).
- `payment_date`, `payment_mode` and `transaction_id` come from the header for every entry (no per-row payment date).
- Submit (→ confirmation dialog) only when Excess = 0 and there are no validation errors.
- **Money** (`lib/payments/money.ts`): exact fixed-point, scale 4 — BigInt units of 0.0001 for parsing, totals, excess, Pay in Full, validation and retry. **Never `Number()` / `parseFloat` for money.** Constants `MAX_RDASH_INT_DIGITS = 29`, `MAX_SUBMIT_INT_DIGITS = 20`, `MAX_DECIMALS = 4`.
  - **Read limit** (rDash amounts — config/details `request_amount`, `paid_amount`, `payment_due`): DECIMAL(33,4) → ≤ 29 integer digits, ≤ 4 decimals (extra zero decimals tolerated). Parsed and displayed exactly; anything else → "Invalid amount from rDash" (row locked, excluded from totals with a note).
  - **Submit limit** (Amount paid, Payment Done, Pay in Full result — the POST bulk API): max `99999999999999999999.9999` (20 integer digits, ≤ 4 decimals). Out of range, 5+ decimals, negative, exponent or non-numeric → "Max amount is 99,999,999,999,999,999,999.9999 (20 digits, 4 decimals)". Inputs block typing beyond 20 integer digits / 4 decimals (`isAllowedAmountInput`).
  - A row whose `payment_due` exceeds the submit limit is shown normally and **counted in Total Due**, but Pay in Full and its input are disabled and it shows "Payment due exceeds the bulk API limit" (can't be paid from PBE; the server rejects it too).
  - **Payload form** (`build-payload.ts`, `BULK_AMOUNT_AS_STRING = false`, TODO(verify) — docs/api-notes.md #19): Swagger types `amount` as `number($float)`. While false, an amount is sent as a JSON number only if it round-trips exactly (≤ 15 significant digits); otherwise the submission is rejected before rDash is called with "Amount too large to submit exactly (rDash API takes numbers) — max 15 significant digits until rDash confirms string amounts". Never a rounded number. When true, the exact decimal string is sent (e.g. `"99999999999999999999.9999"`).
  - **Display** (`formatUnits` / `formatRdashAmount` / `formatMoneyUnits` / `formatCardUnits`): exact digit strings, Indian grouping, 2 decimals normally and up to 4 when the 3rd/4th are non-zero; never rounded.
- Payment Done: `≤ payment_due` and within the submit limit; only rows with `amount > 0` are sent.
- **One currency per payment**: the table shows only the selected currency's rows; the server rejects a submission whose rows (fresh config) span currencies with "All payments must be in the same currency".
- **Payable filter** (`lib/payments/payable.ts`, one shared rule — `PAYABLE_STATUSES`, `isPayableStatus`, `isPayable`): a request is shown only if BOTH (a) config `status` is one of `pending`, `approved`, `submitted` (exact lowercase match; any other or missing status → excluded, never guessed or case-folded) AND (b) `payment_due > 0`. Status values are rDash's `PAYMENT_REQUEST_STATUS` (pending, approved, rejected, cancelled, hold, submitted). `/api/rdash/payment-requests` drops non-payable rows **before** any details call.
- Validation runs on client **and** server with the SAME functions (`lib/payments/validation.ts`: `validateAllocation` for the form, `validateSubmission` for the route; shared `validateHeader`, `checkRowAmount`, `checkExcess`, exact BigInt units via `money.ts`; both enforce the submit limit). Errors are field-keyed (`form` / `header` / `rows[index]`) plus a flat `summary` list.
- Rows with `detailsUnavailable` or `detailsError` cannot take an amount > 0 — **client-only** rule (`validateAllocation`); the bulk route deliberately does not check `project_id` / details. `rowError` (a previous bulk failure — not produced in the current flow, which leaves page 2 after any bulk result) does **not** block validation.
- **Vendor = session vendor.** `api/rdash/payment-requests` and `api/rdash/payment-entries/bulk` use `auth.vendorId` from the session and ignore any vendor id sent by the client (query or body) — never read, compared or forwarded.
- **Server never trusts client payment data.** The bulk route re-fetches the session vendor's config (all pages, user's token) and validates every row against it: `payment_request_id` must be in the fresh list, unique within the submission, have a payable `status` (else "This payment request can't be paid in its current status"), `payment_due > 0`, and `amount ≤` the **server-fetched** `payment_due`. Client-sent `payment_due` / amounts-due are ignored. Any invalid, duplicate or unknown row rejects the whole submission (400) before the bulk API is called.
- Submit is single-flight — in-flight guard + disabled button; no duplicate submissions.
- **Partial failure**: partial prompt — recorded / not-recorded tallies + only the failed rows (Request ID, Project, Amount, Error) → OK → `/payments` reloaded (failed ones still due). There is **no Retry failed and no Remove** — the user starts a new Create Payment for what is still due.
- After a 400 / 403 / network error the table refetches (the submit may have reached rDash) and `mergeRowsAfterSubmit(prev, fresh, null)` keeps the user's edits.
- Submit responses: 200 all created → success prompt → `/payments`; 200 with `failed[]` → partial prompt → `/payments`; 400 → `fieldErrors.rows` mapped back to table rows (`mapServerRowErrors`), "Nothing was recorded" (stay); 403 → permission message (stay); 401 → `apiFetch` saves the state and re-handovers (the submit is never re-sent automatically — see "Session expiry"); 502 / unexpected body → "Could not confirm which payments were recorded" prompt → `/payments`; network error → "Could not confirm whether the payments were recorded…" in the form card's red line (stay). Never shown as success or as "not recorded".
- **Not in PBE**: vendor selector, per-row payment date, paid-through account, drafts, refunds, vendor advance/excess, transaction proof upload (v1 → `transaction_proof_*` = `null`).

## Embedding & Session (handover-only)
Same pattern as RFQ, plus vendor.

1. rDash opens the iframe at `/embedded/bootstrap?vendor_id=<hashid>&org_id=<hashid>&user_id=<hashid>` (`project_id` optional). All IDs are rdash-api hashids for the `bulk_payment` app; PBE keeps them as opaque strings.
2. Bootstrap posts `rdash_iframe_ready` to the parent; rDash replies `rdash_handover { code }` (origin checked against `NEXT_PUBLIC_RDASH_UI_ORIGIN`).
3. Bootstrap redirects to `/api/session?handover=<code>&next=…&vendor_id=…&org_id=…` (built by `lib/embedded-bootstrap-url.ts`).
4. `/api/session`:
   - Missing `vendor_id` → `error=missing_vendor` (checked **before** consuming the code).
   - Consumes the code via `POST /api/v1/auth/embedded/handover/consume/` (JWT client_assertion). Missing `expires_in` → `AuthError` → `session_error` (never defaulted). The refresh token in the response is ignored.
   - Real mode: `app_slug` must equal `RDASH_PBE_TAB_CODE`; missing or different → `error=session_error`. Mock mode skips this check.
   - `orgId` comes **only** from the handover response (`org.id`). A URL `org_id` that differs → `error=org_mismatch`.
   - Verifies the vendor with the **new** token via `assertVendorInOrg()` (`/v2/vendors`; a 401 there → `session_error`). Not found / undecodable → `error=vendor_not_found`; rDash 403 → `error=vendor_forbidden`.
   - On success sets the encrypted cookie (`pbe-auth`) and redirects to `/payments?orgId=…&projectId=…&userId=…&vendorId=…`.
   - No cookie is set on any error. Error redirects carry only a fixed code; details go to the server log.
   - Error redirects are cached 5 min per handover code so a replayed URL can't re-consume it; generic `session_error` is not cached.
5. Bootstrap shows a fixed message per error code (`BOOTSTRAP_ERROR_MESSAGES`), e.g. missing_vendor → "Please open Bulk Payment from a vendor's Vendor Payments page."
6. Bootstrap's `/api/auth/me` probe sends the URL org/user/vendor/project context, so middleware can detect a cookie for a different vendor/org/user.
7. `force=1` recovery (api-fetch 401): bootstrap reads the vendor from `next` (`vendorId`) as well as the URL; no vendor → `missing_vendor`, never a fallback to the cookie's vendor.

Handover returns: `access_token` (~15 min — **TBD**, see Open Items), `refresh_token` (ignored — PBE never refreshes), `user {id, display_name, email}`, `org {id, name, type}`, `app_slug`. It does **not** return vendor or project — `vendor_id` comes from the iframe URL and is verified server-side against `/v2/vendors`.

Session cookie payload: `accessToken`, `expiresAt` (access-token expiry), `orgId`, `projectId` (optional), `userId`, `vendorId`, `displayName`, `email` (`null` when rDash omits it), `tabCode` (`app_slug`; `null` only in mock mode), `lastPath`.

### Session expiry — re-handover, no refresh, no DB
rDash refresh tokens are single-use and concurrent refreshes revoke the session ("replay"), which used to need Postgres + advisory locks. PBE therefore **never refreshes**: no refresh token is stored, `/api/v1/auth/token/` is never called, and there is no database or Redis. When the access token expires, the iframe gets a fresh handover code from rDash (the parent page is still logged in) and logs in again.
- **Server**: an expired cookie access token (`expiresAt` ≤ now, or missing) **or** an rDash 401 on any call → `SessionExpiredError` → `401 { "error": "session_expired" }` + cookie cleared (`authErrorResponse`). The rDash call is never retried with another token. Middleware clears an expired cookie: on `/api/*` it answers `401 session_expired` itself; pages pass through without the cookie. Other auth failures keep `{ "error": "Not authenticated" }`.
- **Browser** (`lib/api-fetch.ts`): on 401, run the `onBeforeRehandover` hooks (`/payments/new` saves its unsaved state — the payment form (header), selected currency, row amounts + remarks keyed by `payment_request_id`, current table page — to sessionStorage via `lib/payments/draft.ts`, scoped to vendor + currency), then navigate to `/embedded/bootstrap?force=1&next=<current path>`. Bootstrap does the normal handshake (`rdash_iframe_ready` → `rdash_handover` → `/api/session`) and returns to `next`.
- **Restore**: the handover returns to the same route (`next=/payments/new?currency=…`); `/payments/new` restores the draft once after the (latest) rows load, only for the same vendor and only into rows that still exist (form, amounts, remarks, table page), then deletes it. A successful submit and "← Back" also clear the draft. Drafts in an older shape are discarded. `/payments` and `/payments/new` are the restorable `lastPath`s.
- **Loop guard**: a sessionStorage marker is set when a re-handover starts and cleared by the next successful API call. A 401 within 60 s while it is set → `/embedded/bootstrap?error=session_renew_failed` ("Session could not be renewed — reload the tab.") instead of another handover.
- **Submit safety**: a bulk submit is **never** re-sent automatically. If the submit got `session_expired`, the user sees the restored form and presses Submit again (if rDash recorded it before the 401, the fresh config reload shows it as paid).
- Mock mode and DEV static-token mode are unchanged (no handover / no cookie).

Cookie: `HttpOnly; Secure; SameSite=None`, emitted both Partitioned and unpartitioned (CHIPS), same as RFQ; dev (`http://localhost`) uses a single `SameSite=Lax` cookie. `Max-Age` = until the access token expires. Cookies are always written as raw `Set-Cookie` headers on the response (never `cookies().set()`, which collapses the dual-emit).

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
│   │   ├── payments/                   # Page 1: PaymentsListClient (read-only list, + Create Payment); usePaymentRequests.ts (shared load + currency)
│   │   │   ├── components/             # SummaryCards (AmountCard, VendorSummaryCards), AllocationTable (+ TableBox, TablePagination), AllocationRow, CreatePageHeader, CreatePaymentForm, RdModal, SubmitPrompt, PayloadPreview, EmptyState
│   │   │   └── new/                    # Page 2: NewPaymentClient ("Create RFQ"-style header + form card + table → Submit → bulk → result prompt)
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
│   │   ├── payments/                   # money.ts, validation.ts, totals.ts, remarks.ts, allocation.ts, build-payload.ts, submit.ts, draft.ts, pagination.ts, payment-form.ts, summary.ts, filters.ts, table-display.ts (pure, shared client+server)
│   │   ├── server/                     # `import "server-only"`
│   │   │   ├── api.ts                  # apiFetch, paginateRdash(Drf) (401 → SessionExpiredError, no retry), assertVendorInOrg; errors: RdashPermissionError, VendorNotFoundError, RdashUpstreamError, RdashResponseShapeError, RdashIdDecodeError
│   │   │   ├── auth.ts                 # Handover, JWT cookie, getAuth, SessionExpiredError, authErrorResponse (AuthPayload incl. vendorId)
│   │   │   ├── respond-safe.ts
│   │   │   └── rdash-source/           # index.ts (getRdashSource), mode.ts (getDataSource), types.ts (RdashSource), real.ts, mock.ts, allocation-rows.ts (config+details merge), mock-data/
│   │   ├── embedded-bootstrap-url.ts   # Pure bootstrap URL helpers + BOOTSTRAP_ERROR_MESSAGES (unit tested)
│   │   ├── api-fetch.ts                # Client fetch wrapper (401 → save form → /embedded/bootstrap?force=1; loop guard)
│   │   ├── auth-context.tsx            # Client SessionProvider + useSession + buildUrl (carries vendorId)
│   │   ├── embedded-parent-origin.ts
│   │   └── utils.ts
│   └── types/{rdash,payments}.ts
├── tests/                              # vitest: helpers.ts, middleware-coverage, vendor-context, session-expiry, api-fetch, payment-draft, pagination, payment-form, summary, table-filters, payments
├── k8s/{dev,prod}/
├── .github/workflows/                  # deploy-dev.yml, deploy-prod.yml
├── docs/api-notes.md                   # Every unverified rDash assumption (each marked TODO(verify) in code)
├── Dockerfile
└── docker-compose.yml
```

## Database
None. No business data and no session store — all payment data lives in rDash and the session is the encrypted cookie (access token only). `DATABASE_URL` is not used; startup does not need it.

## rDash API Endpoints (consumed)
Base: `RDASH_API_URL`. List endpoints **must** go through `paginateRdash` — never single-page.

| Endpoint | Purpose | Required Permission |
|---|---|---|
| `POST /api/v1/auth/embedded/handover/consume/` | Handover code → tokens | client_assertion (JWT) |
| `GET /v2/vendors` | Server-side vendor verification only (`assertVendorInOrg`) — never shown as a dropdown | `CAN_ACCESS_MANAGE_VENDOR` (per RFQ docs; **verify**) |
| `GET /v2/projects` | Project names for the Project Name column — **DRF paginated** (confirmed, 809 in the prod org); fetched only when a row has a `project_id`, id → name list cached server-side per token for 5 min (no id filter known — api-notes #18) | auth-only |
| `GET /v2/vendor-payment-requests/config/?vendor_id&limit&offset&payment_request_ids` | Vendor's payment requests (all projects) + amounts | **TBD** |
| `GET /v2/projects/{pid}/vendor-payment-requests/{payment_request_id}` | Request details for table columns | **TBD** |
| `POST /v2/vendor-payment-requests/payment-entries/bulk/` | Create payment entries | **TBD** |

### Response fields (corrected Swagger + a real production response — only these exist; never invent fields)
- **Vendors**: `id, name, code`
- **Projects** (DRF page, like config): `results[]` → `id, job_id, name, created_at, is_archived, is_deleted`
- **Config** (`PaginatedVendorPaymentRequestConfigOutputEntity`) — **DRF pagination**: `{ data: { count, next, previous, results[] } }` (real sample: `tests/fixtures/real-config-page.json`). `results[]` → `payment_request_id, project_id (required), status, request_amount, paid_amount, payment_due, currency { id: string|null, name, symbol, code, locale? }`. Paged by `paginateRdashDrf`: follow `next` until null (same origin/path as `RDASH_API_URL` only), total must equal `count`, else `RdashResponseShapeError`.
- **Money**: amounts are **decimal strings** with up to 4 decimals (`"29500.0000"`, `"0"`, `"0.0"`); details amounts may be strings or numbers. Parse ONLY with `parseRdashAmount` (`lib/payments/money.ts`): exact BigInt units (0.0001) within DECIMAL(33,4) — ≤ 29 integer digits, ≤ 4 decimals; anything else → "Invalid amount from rDash" (never rounded; row locked, excluded from totals, rejected by the server). See Key Rules → Money for the submit limit. Display via `formatRdashAmount` (digit-string based, exact for any size). Currency symbol from `currency.symbol` (`lib/payments/currency.ts`).
- **Statuses seen**: approved, pending, submitted, cancelled.
- **Details** (`PaymentRequestDetailsOutputEntity`): `id, request_id?, request_number?, vendor{id,name}, client{id,name}, request_type, requested_by {id, name} | null, requested_at, invoice?{id,number}, purchase_order?{id,number}, request_amount_without_tax, tax_amount, total_request_amount, paid_till_date, payment_due, remark?, due_date?, request_status, attachments[] {id, file, name, uploaded_by{id,name}, uploaded_at}`
- **Bulk input** (`ExternalBulkPaymentEntryCreateInputEntity`): body **`{ entries: [...] }`** (Swagger's "data" is only the body param name; `BULK_BODY_WRAPPER = "entries"`). `entries[]` → `payment_request_id*, amount* (Swagger number($float); exact JSON number ≤ 15 significant digits, or exact decimal string when BULK_AMOUNT_AS_STRING — max 20 integer digits + 4 decimals), payment_mode*, payment_date* ("YYYY-MM-DD"), transaction_id?, transaction_proof_file_url?, transaction_proof_file_name?, remark?`
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
Same as RFQ: rDash 403 → `RdashPermissionError` → `{ "error": "You do not have access to perform this action" }` at HTTP 403. rDash 401 or an expired access token → `{ "error": "session_expired" }` at 401, cookie cleared → re-handover (never refreshed, never retried). Every other auth 401 body is the fixed `{ "error": "Not authenticated" }` (`authErrorResponse`); the reason goes to `console.error`. rDash error bodies/messages never become client text: non-2xx or `success: false` → `RdashUpstreamError` ("rDash request failed"), unexpected list shape → `RdashResponseShapeError`, undecodable id → `RdashIdDecodeError` (never an empty list, never a raw id). Other upstream errors → 502 with a generic message + detailed `console.error`. Never return fake empty arrays on error. A failed details call marks that row with an error — never silently dropped.

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
| `/api/rdash/payment-requests` | GET | Uses session `vendorId` (no vendor param). Config (all pages) + details (parallel, concurrency 5, only rows with `project_id`) → `{ rows, summaries }`: merged allocation rows (payable only) + page-1 card figures per currency code from the FULL config (`summarizeConfig`, exact decimal strings) |
| `/api/rdash/payment-entries/bulk` | POST | Body `{ header, rows }` → re-fetch config for session vendor → server validation → build payload → bulk create → `{ count, created, failed, recordedAmount, notRecordedAmount }` |

All three use `getSessionOrMock` and map errors via `lib/server/route-errors.ts` (401 `session_expired` or fixed message / 403 fixed message / 502 generic). Bulk details:
- Body `{ header, rows: [{ payment_request_id, amount, remark }] }`; only those fields are read. A vendor id in the body is ignored; a vendor id in the **query** that differs from the session makes `getAuth` refuse the request (401).
- Validation (`lib/payments/validation.ts`, exact BigInt units) → `400 { error: "Validation failed", fieldErrors: { form[], header{}, rows{ [index]: { field: msg } } } }`; the bulk API is not called.
- If rDash's `created` + `failed` don't cover every submitted id exactly once → `502` ("Could not confirm which payments were recorded…"): nothing is reported as "not recorded", so a retry can't pay twice.
- The 400 body also carries `summary: string[]`.

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
  - Ids are sent to rDash **exactly as given** (as in every mode); `/api/auth/me` returns them as-is plus `authMode: "static_token"`; the UI shows a **DEV — REAL DATA** badge.
  - **Writes blocked** unless `RDASH_DEV_ALLOW_WRITES=true`: the bulk route returns 403 "Writes disabled in dev static-token mode" before any rDash call.
  - The token is never logged or returned. `scripts/rdash-dump.ts` (`npx tsx --env-file=.env.local scripts/rdash-dump.ts "<vendor name>"`) prints raw JSON of `/v2/vendors?name=`, the config for `RDASH_DEV_VENDOR_ID` (all pages via `next`) and details for the first payable row; GET only (never the bulk POST), token redacted.

## Deployment

### CI/CD
- GitHub Actions on push to `main` (paths: `src/`, `public/`, `Dockerfile`, `package.json`).
- Pipeline: lint → type-check → test → Docker build → push ACR → deploy AKS.

### K8s
- Namespaces `pbe-dev` / `pbe-prod`. Probes hit `/api/health`.
- Secret: `pbe-app-config` (no database credentials — PBE has no DB).
- Manifests set `RDASH_DATA_SOURCE=real` explicitly.
- CSP `frame-ancestors` allows only the rDash UI origin; no `X-Frame-Options: DENY`.

### Environment
| Variable | When | Description |
|---|---|---|
| `RDASH_API_URL` | Runtime | rDash API base |
| `RDASH_APP_URL` | Runtime | rDash web app URL |
| `RDASH_PBE_TAB_CODE` | Runtime | Embedded tab slug (`bulk_payment` — the slug rdash-api registered; rdash-api keeps it in its app registry, not in an env variable); must equal the handover `app_slug`. Required when `RDASH_DATA_SOURCE=real` (startup fails without it); not used in mock mode |
| `RDASH_CLIENT_ID` / `RDASH_CLIENT_KID` / `RDASH_CLIENT_ALG` / `RDASH_CLIENT_PRIVATE_KEY_PEM` | Runtime | Handover client_assertion JWT |
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
- rDash IDs are opaque strings: stored, compared (URL ↔ cookie) and sent back to rDash exactly as rDash gave them — never decoded or re-encoded (docs/api-notes.md #1).
- `apiFetch()` for client API calls; `buildUrl()` for navigation (carries orgId/projectId/userId/vendorId). `apiFetch` sends requests as-is (no ids appended). **Intentional exceptions (plain `fetch`):**
  - `embedded/bootstrap/page.tsx` `/api/auth/me` probe — a 401 is the expected "no session" answer; `apiFetch`'s 401 handler would redirect back to bootstrap (loop).
  - `EmbeddedLogoutListener` — `apiFetch`'s 401 handler would start a fresh handover during logout.
  - **Not yet decided:** `lib/auth-context.tsx` `SessionProvider` still uses plain `fetch` for `/api/auth/me`. It is mounted in the root layout (so also on `/embedded/bootstrap`, where it skips the ping by pathname).
- **No silent fallbacks** — no default values for missing data, no alternate sources. Surface errors. **Intentional exception:** bootstrap posts the constant `rdash_iframe_ready` signal with `targetOrigin "*"` when the parent origin can't be detected — it carries no secret, the handover reply (with the code) is always origin-checked against `NEXT_PUBLIC_RDASH_UI_ORIGIN`, and origin detection fails in some browsers (no `ancestorOrigins`, stripped referrer).
- **Never invent API fields.** Unverified behavior is isolated, marked `TODO(verify)`, and listed in `docs/api-notes.md`.
- Generic error responses; detailed `console.error` for server logs.
- Currency from `currency.symbol` (one currency per payment, see the currency filter), Indian number format, exact money (never floats). Color: red primary `#E53935`. Font: Gilroy.
- Work in small steps; after each task list changed files + how to test. Ask when unclear. Don't commit unless asked.
- Never modify anything outside this repo (especially `<RFQ_PATH>`). Never touch `.env.local`.

## Commands
- `npm run dev` — dev server (port 3000)
- `npm run build` — standalone production build
- `npm run lint` — ESLint
- `npm test` — vitest
- `docker compose up --build` — local app

## Open Items (verify with rDash team)
- **Access-token lifetime** (`expires_in` from the handover): every expiry costs a re-handover (form restored). Confirm the value (~15 min assumed) and that the parent always answers `rdash_iframe_ready` with a fresh code while its own session is alive (docs/api-notes.md #6).
- **App registration**: `client_id`, `kid`, tab slug, iframe origin whitelist (we send the public key). The hashid salt lives only in rdash-api (`EMBEDDED_APPS_HASH_ID_SALT_BULK_PAYMENT` on their side) — PBE does not need it.
- **Iframe URL encoding**: confirm the iframe / handover ids are accepted back unchanged by the `/v2` APIs called with our embedded token (PBE sends them as-is), and that the sub-tab `src` is always `/embedded/bootstrap?...` (never `/api/session` directly).
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
- **Currency**: shape resolved (`{ id, name, symbol, code, locale? }`). A vendor can have payable requests in several currencies — handled with the currency filter (one currency per payment; server rejects mixes).
- **Bulk `amount` as a decimal string**: is it a DecimalField that accepts `"99999999999999999999.9999"`? Until confirmed, `BULK_AMOUNT_AS_STRING = false` caps submits at 15 significant digits (docs/api-notes.md #19).
- **Permissions**: `CAN_*` required for config, details, bulk.
- **rdash-api logging**: confirm `X-Pbe-Referer/Origin/User-Agent/Client-Ip` are bound (only `X-Rfq-*` known).
- **Payment history**: no API to list past payment entries yet (the old empty list page was removed; rDash's own Payment Entries tab shows them).
- **Transaction proof upload**: no upload endpoint known — out of v1.