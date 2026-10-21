"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { CurrencyFilter } from "@/components/rd/CurrencyFilter";
import { rdTextLink } from "@/components/rd/styles";
import { useUI } from "@/components/ui/toast-confirm";
import { apiFetch, onBeforeRehandover } from "@/lib/api-fetch";
import { useSession } from "@/lib/auth-context";
import { validateAllocation, validateHeader } from "@/lib/payments/validation";
import { computeTotals } from "@/lib/payments/totals";
import { listCurrencies, resolveSelectedCurrency } from "@/lib/payments/currency";
import { applyHeaderRemark, setRowRemark } from "@/lib/payments/remarks";
import {
  autoAllocate,
  autoAllocatePaidUnits,
  clearAppliedAmounts,
  hasReplaceableAmounts,
  payInFull,
  setRowAmount,
} from "@/lib/payments/allocation";
import { buildBulkEntries, buildSubmitRequest } from "@/lib/payments/build-payload";
import { applyDraftRows, buildDraft, clearDraft, saveDraft, takeDraft } from "@/lib/payments/draft";
import {
  EMPTY_HEADER,
  PAYMENTS_PATH,
  formLevelMessage,
  hasEnteredAnything,
  visibleFieldErrors,
  withCurrency,
  type SubmitOutcome,
} from "@/lib/payments/payment-form";
import {
  isBulkSubmitResult,
  isValidationRejection,
  mapServerRowErrors,
  mergeRowsAfterSubmit,
  submitPromptFor,
  type SubmitPrompt as SubmitPromptState,
} from "@/lib/payments/submit";
import type { BulkPaymentEntryInput } from "@/types/rdash";
import type { AllocationRow, BulkSubmitRequest, PaymentHeader as PaymentHeaderValue } from "@/types/payments";
import { CreatePaymentForm } from "../components/CreatePaymentForm";
import { CreatePageHeader } from "../components/CreatePageHeader";
import { AllocationTable, TableBox, TablePagination, TableSkeleton } from "../components/AllocationTable";
import { useFilteredPaging } from "../useFilteredPaging";
import { EmptyState, LoadError } from "../components/EmptyState";
import { PayloadPreviewLink } from "../components/PayloadPreview";
import { SubmitPrompt } from "../components/SubmitPrompt";
import { errorText, fetchRows, usePaymentRequests } from "../usePaymentRequests";

/** What will be / was sent (mock payload preview). */
interface Sent {
  request: BulkSubmitRequest;
  entries: BulkPaymentEntryInput[];
}

const BULK_URL = "/api/rdash/payment-entries/bulk";
const SUBMIT_UNKNOWN =
  "Could not confirm whether the payments were recorded. Check Payment Entries in rDash before submitting again.";
const REFRESH_ERROR = "Payments were submitted, but the table could not be refreshed.";

// sessionStorage for the unsaved-form draft; null when the browser blocks it.
function draftStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// /payments/new — page 2, "Create Payment", laid out like the RFQ "Create
// RFQ" page (docs/ui-reference/rfq-create): header "← Create Payment" with
// Cancel + Submit; the payment form card (Amount Paid, Payment Date, Payment
// Mode, Reference / UTR, Remark, live Allocated / Excess, Total Due line);
// then the allocation table (Payment Done, Pay in full, Remarks; filters,
// paging). Submit validates (existing client validation) and calls the bulk
// API directly. Then an rDash result prompt (components/SubmitPrompt.tsx):
// all recorded → success; some failed → partial (failed rows); 502 →
// "could not confirm"; OK → /payments (reloaded). 400 / 403 / network →
// stay, nothing cleared.
// Every calculation / rule comes from lib/payments; this component only holds
// state and wires events.
export function NewPaymentClient() {
  const router = useRouter();
  const { buildUrl, dataSource, vendorId } = useSession();
  const { confirm } = useUI();

  // Payment form (the header of every entry).
  const [header, setHeader] = useState<PaymentHeaderValue>(EMPTY_HEADER);
  // Fields the user has edited (their errors show) / Submit pressed (all show).
  // Latest header remark for rows arriving after it was set.
  const headerRemarkRef = useRef(header.remark);
  headerRemarkRef.current = header.remark;
  const data = usePaymentRequests({ prepare: (rs) => applyHeaderRemark(rs, headerRemarkRef.current) });
  const { rows, setRows, load, visibleRows, selectedOption, selectedCurrency, currencyOptions, needsCurrencyPick, noCurrencyCount } = data;
  const [attempted, setAttempted] = useState(false);

  // ── Submit state ──
  // Single-flight: the ref blocks a second submit before React re-renders;
  // `submitting` drives the disabled button + spinner.
  const inFlightRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  // 400 / 403 / network errors (stay on page 2; one red line in the form
  // card footer, row / field errors inline).
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  // Result prompt after a bulk response (success / partial / unconfirmed)
  // → OK → /payments.
  const [prompt, setPrompt] = useState<SubmitPromptState | null>(null);
  const [lastSent, setLastSent] = useState<Sent | null>(null);
  const [serverRowErrors, setServerRowErrors] = useState<Record<number, string>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Field errors from a server 400 (shown under the fields, client first).
  const [serverHeaderErrors, setServerHeaderErrors] = useState<Record<string, string>>({});

  const goToList = () => router.push(buildUrl(withCurrency(PAYMENTS_PATH, selectedCurrency)));

  const totals = useMemo(() => computeTotals(header.amountPaid, visibleRows), [header.amountPaid, visibleRows]);
  const currency = useMemo(() => ({ symbol: selectedOption?.symbol || null, mixed: false }), [selectedOption]);
  const validation = useMemo(() => validateAllocation(header, visibleRows), [header, visibleRows]);
  const entered = hasEnteredAnything(header, rows);
  const fieldErrors = visibleFieldErrors({ ...serverHeaderErrors, ...validateHeader(header).errors }, attempted);

  // Row errors show only after Submit (then live). Client errors first; a
  // server 400 message shows on rows the client considers valid.
  const rowErrors = useMemo(() => {
    const out: Record<number, Record<string, string>> = {};
    if (!attempted) return out;
    for (const [i, msg] of Object.entries(serverRowErrors)) out[Number(i)] = { amount: msg };
    for (const [i, fields] of Object.entries(validation.errors.rows)) out[Number(i)] = fields;
    return out;
  }, [attempted, serverRowErrors, validation.errors.rows]);

  // Filters + paging are display-only (useFilteredPaging): totals, validation
  // and submit use visibleRows (every row of the currency); row indices stay
  // global, so amounts on other pages / hidden rows are kept.
  const view = useFilteredPaging(visibleRows, selectedCurrency, data.loadSeq, Object.keys(rowErrors).map(Number));
  const { slice } = view;
  const page = slice.page;

  // ── Session expiry (re-handover) ──
  // apiFetch returns to this route (next=<current path>). Latest state for the
  // save hook below (it runs outside React): form, amounts, remarks, page.
  const draftSourceRef = useRef({ vendorId, currency: selectedCurrency, header, rows, page });
  draftSourceRef.current = { vendorId, currency: selectedCurrency, header, rows, page };
  useEffect(
    () =>
      onBeforeRehandover(() => {
        const s = draftSourceRef.current;
        const draft = buildDraft(s.vendorId, s.currency, s.header, s.rows, s.page);
        const store = draftStorage();
        if (draft && store) saveDraft(store, draft);
      }),
    [],
  );
  // Back from the handover: restore once, into rows that still exist, then
  // the draft is gone (takeDraft deletes it).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || load.status !== "ready" || !vendorId) return;
    restoredRef.current = true;
    const store = draftStorage();
    const draft = store ? takeDraft(store, vendorId) : null;
    if (!draft) return;
    const restored = applyDraftRows(rows, draft);
    setHeader(draft.header);
    setRows(restored);
    if (draft.currency) data.setPickedCurrency(draft.currency);
    const code = resolveSelectedCurrency(listCurrencies(restored), draft.currency);
    view.restorePage(draft.page, code, data.loadSeq);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once after the first load
  }, [load.status, vendorId, rows]);

  const current = useMemo<Sent | null>(
    () =>
      validation.ok
        ? { request: buildSubmitRequest(header, validation.value), entries: buildBulkEntries(validation.value) }
        : null,
    [validation, header],
  );


  const edited = () => {
    setServerRowErrors((e) => (Object.keys(e).length ? {} : e));
    setServerHeaderErrors((e) => (Object.keys(e).length ? {} : e));
  };
  // `index` is the row's position in the (currency-filtered) table; rows are
  // updated by payment_request_id so filtering can never hit the wrong row.
  const updateRow = (index: number, fn: (r: AllocationRow) => AllocationRow) => {
    if (inFlightRef.current) return;
    const id = visibleRows[index]?.config.payment_request_id;
    if (!id) return;
    edited();
    setRows((rs) => rs.map((r) => (r.config.payment_request_id === id ? fn(r) : r)));
  };

  // Form field change; the Remark is copied to every row without its own.
  const setHeaderField = <K extends keyof PaymentHeaderValue>(field: K, value: PaymentHeaderValue[K]) => {
    if (inFlightRef.current) return;
    edited();
    setHeader((h) => ({ ...h, [field]: value }));
    if (field === "remark") setRows((r) => applyHeaderRemark(r, value as string));
  };

  // Refetch after an error response that stays on this page (and after a
  // network error — the submit may have reached rDash), keeping the edits.
  const refreshAfter = async () => {
    const r = await fetchRows();
    if (!r.ok) {
      setRefreshError(REFRESH_ERROR);
      return;
    }
    setRefreshError(null);
    data.bumpLoadSeq();
    setRows((prev) => mergeRowsAfterSubmit(prev, r.rows, null));
  };

  // Leaving page 2 after a submit (all recorded / popup OK) or Back.
  const leave = () => {
    const store = draftStorage();
    if (store) clearDraft(store, vendorId);
    goToList();
  };

  const send = async (sent: Sent) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setOutcome(null);
    setServerRowErrors({});
    setServerHeaderErrors({});
    setLastSent(sent);
    let stay = true;
    try {
      let res: Response;
      try {
        res = await apiFetch(BULK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sent.request),
        });
      } catch (err) {
        // The request may or may not have reached rDash.
        console.error("[new-payment] submit network error", err);
        setOutcome({ kind: "error", message: SUBMIT_UNKNOWN });
        return;
      }
      // 401: apiFetch saved the state (draft) and is navigating to a fresh
      // handover, which returns here. The submit is NOT re-sent — the user
      // submits again from the restored page (a payment rDash already
      // recorded shows as paid after reload).
      if (res.status === 401) {
        stay = false;
        return;
      }
      const body: unknown = await res.json().catch(() => null);

      if (res.ok && isBulkSubmitResult(body)) {
        stay = false;
        // All recorded → success prompt; some failed → partial prompt (only
        // the failed rows). OK → /payments (fresh load shows the new dues).
        setPrompt(submitPromptFor(body, sent.request, rows));
      } else if (res.status === 400 && isValidationRejection(body)) {
        setServerRowErrors(mapServerRowErrors(sent.request, body.fieldErrors, visibleRows));
        setServerHeaderErrors(body.fieldErrors.header);
        setOutcome({ kind: "rejected", form: body.fieldErrors.form });
      } else if (res.status === 403) {
        setOutcome({ kind: "error", message: errorText(body, "You do not have access to perform this action") });
      } else {
        // 502 (incl. "created + failed don't cover every entry") or an
        // unexpected 200 body: which payments were recorded is unknown →
        // popup → OK → /payments (the reload shows what is still due).
        if (res.ok) console.error("[new-payment] unexpected bulk response body", body);
        stay = false;
        setPrompt({ kind: "unconfirmed" });
      }
    } finally {
      if (stay) await refreshAfter();
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  // Submit = the existing client validation, then the bulk API directly.
  const onSubmit = () => {
    if (inFlightRef.current) return;
    setAttempted(true);
    // Re-validate at click time from the latest state (never a stale render).
    const v = validateAllocation(header, visibleRows);
    if (!v.ok) return;
    void send({ request: buildSubmitRequest(header, v.value), entries: buildBulkEntries(v.value) });
  };

  // Switching currency with amounts entered: confirm, then clear them (an
  // amount in one currency must never count against another).
  const onCurrencyChange = async (code: string) => {
    if (inFlightRef.current) return;
    if (rows.some((r) => r.amount.trim() !== "")) {
      const ok = await confirm({
        title: "Change currency?",
        message: "The amounts you entered will be cleared.",
        confirmLabel: "Change currency",
        cancelLabel: "Keep current",
        variant: "danger",
      });
      if (!ok) return;
      setRows((r) => clearAppliedAmounts(r));
    }
    edited();
    data.setPickedCurrency(code);
  };

  // Auto allocate: Amount Paid spread over the rows in display order (filters
  // applied, all pages, this currency); rows outside the filter are cleared.
  // Asks first when an editable row already has an amount.
  const onAutoAllocate = async () => {
    if (inFlightRef.current || autoAllocatePaidUnits(header.amountPaid) === null) return;
    if (hasReplaceableAmounts(visibleRows)) {
      const ok = await confirm({
        title: "Replace the amounts already entered?",
        message: "Payment Done will be filled from Amount Paid, top to bottom.",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
    }
    const order = view.shown.map((s) => s.row.config.payment_request_id);
    const amountPaid = header.amountPaid;
    edited();
    setRows((rs) => autoAllocate(rs, order, amountPaid));
  };

  // "←" / Cancel → /payments; asks first when anything was entered (a form
  // field, a row amount or a row's own remark).
  const onBack = async () => {
    if (inFlightRef.current) return;
    if (entered) {
      const ok = await confirm({
        title: "Discard entered amounts?",
        message: "The payment details and amounts you entered will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        variant: "danger",
      });
      if (!ok) return;
    }
    leave();
  };

  const formMessage = formLevelMessage({ attempted, formErrors: validation.errors.form, outcome });
  const preview = current ? { label: "will be sent", sent: current } : lastSent ? { label: "last sent", sent: lastSent } : null;

  return (
    <>
      {/* Header like "← Create RFQ" (Save as Draft / Create & Send). */}
      <CreatePageHeader
        title="Create Payment"
        onBack={() => void onBack()}
        backDisabled={submitting}
        actions={
          <>
            <CurrencyFilter
              options={currencyOptions}
              selected={selectedOption?.code ?? null}
              onSelect={(code) => void onCurrencyChange(code)}
              disabled={submitting || load.status !== "ready"}
            />
            <CreatePageHeader.Cancel onClick={() => void onBack()} disabled={submitting} />
            <CreatePageHeader.Submit
              onClick={onSubmit}
              sending={submitting}
              disabled={load.status !== "ready" || visibleRows.length === 0 || submitting}
            />
          </>
        }
      />
      {/* Session error banner only (the DEV badge is in the header). */}
      <PageHeader bannerOnly />
      {/* Fills the remaining height; only the table rows scroll (TableBox). */}
      <main className="flex min-h-0 flex-1 flex-col px-6 py-5">
        {/* Disabled while a submit is in flight — no edits can race the response. */}
        <fieldset disabled={submitting} aria-busy={submitting} className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
          <CreatePaymentForm
            value={header}
            errors={fieldErrors}
            onChange={setHeaderField}
            totals={totals}
            loaded={load.status === "ready" && selectedOption !== null}
            payableCount={visibleRows.length}
            symbol={currency.symbol}
            canAutoAllocate={
              load.status === "ready" && selectedOption !== null && autoAllocatePaidUnits(header.amountPaid) !== null
            }
            onAutoAllocate={() => void onAutoAllocate()}
            formMessage={formMessage}
            footerExtra={
              <>
                {refreshError ? (
                  <span role="alert" className="shrink-0 text-xs text-red-600">
                    {refreshError}{" "}
                    <button type="button" className={`${rdTextLink} text-xs underline`} onClick={() => void refreshAfter()}>
                      Retry
                    </button>
                  </span>
                ) : null}
                {load.status === "ready" && noCurrencyCount > 0 ? (
                  <span className="shrink-0 text-xs text-rd-pending">
                    {noCurrencyCount} request{noCurrencyCount === 1 ? " has" : "s have"} no currency from rDash and can&apos;t be shown.
                  </span>
                ) : null}
              </>
            }
          />

          <TableBox
            title={
              <>
                Payment due
                <span className="ml-1 font-normal text-rd-muted">
                  · {totals.selectedCount} of {visibleRows.length} selected
                </span>
              </>
            }
            action={
              <div className="flex items-center gap-5">
                {dataSource === "mock" && preview ? (
                  <PayloadPreviewLink label={preview.label} request={preview.sent.request} entries={preview.sent.entries} />
                ) : null}
                {view.active ? (
                  <button type="button" className={rdTextLink} onClick={view.clearFilters}>
                    Clear filters
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={load.status !== "ready" || totals.selectedCount === 0}
                  onClick={() => {
                    if (inFlightRef.current) return;
                    edited();
                    setRows((r) => clearAppliedAmounts(r));
                  }}
                  className={rdTextLink}
                >
                  Clear applied amount
                </button>
              </div>
            }
            footer={
              load.status === "ready" && visibleRows.length > 0 ? (
                <TablePagination
                  slice={slice}
                  errorPages={view.errorPages}
                  hiddenErrors={view.hiddenErrors}
                  onClearFilters={view.clearFilters}
                  onPage={view.goToPage}
                />
              ) : (
                <span className="h-8" />
              )
            }
          >
            {/* The column header stays visible in every state; loading /
                error / empty show inside the scroll area under it. */}
            <AllocationTable
              currencySymbol={currency.symbol}
              items={load.status === "ready" ? slice.rows : []}
              filters={view.filters}
              filterOptions={view.options}
              onFilters={view.setFilters}
              todayKey={view.todayKey}
              placeholder={
                load.status === "loading" ? (
                  <TableSkeleton />
                ) : load.status === "error" ? (
                  <LoadError message={load.message} onRetry={() => void data.loadRows()} />
                ) : rows.length === 0 ? (
                  <EmptyState />
                ) : needsCurrencyPick ? (
                  <EmptyState message="Select a currency to see payment requests" />
                ) : view.shown.length === 0 && visibleRows.length > 0 ? (
                  <EmptyState message="No payment requests match your filters" />
                ) : null
              }
              placeholderAlign={load.status === "loading" ? "top" : "center"}
              rowErrors={rowErrors}
              onAmount={(i, v) => updateRow(i, (r) => setRowAmount(r, v))}
              onPayInFull={(i) => updateRow(i, payInFull)}
              onRemark={(i, v) => updateRow(i, (r) => setRowRemark(r, v))}
            />
          </TableBox>
        </fieldset>
      </main>

      <SubmitPrompt prompt={prompt} symbol={currency.symbol} busy={submitting} onOk={leave} />
    </>
  );
}
