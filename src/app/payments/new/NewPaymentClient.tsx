"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { rdButtonOutline, rdButtonPrimary, rdCard, rdTextLink } from "@/components/rd/styles";
import { useUI } from "@/components/ui/toast-confirm";
import { apiFetch, onBeforeRehandover } from "@/lib/api-fetch";
import { useSession } from "@/lib/auth-context";
import { validateAllocation } from "@/lib/payments/validation";
import { computeTotals } from "@/lib/payments/totals";
import {
  listCurrencies,
  resolveSelectedCurrency,
  rowsForCurrency,
  rowsWithoutCurrency,
} from "@/lib/payments/currency";
import { CurrencyFilter } from "@/components/rd/CurrencyFilter";
import { applyHeaderRemark, setRowRemark } from "@/lib/payments/remarks";
import { clearAppliedAmounts, dismissFailedRow, payInFull, setRowAmount } from "@/lib/payments/allocation";
import { buildBulkEntries, buildSubmitRequest } from "@/lib/payments/build-payload";
import { buildRetryEntries, buildRetryRequest, removeFailedId, retryAmountPaid } from "@/lib/payments/retry";
import { applyDraftRows, buildDraft, clearDraft, saveDraft, takeDraft } from "@/lib/payments/draft";
import {
  isBulkSubmitResult,
  isValidationRejection,
  mapServerRowErrors,
  mergeRowsAfterSubmit,
  sentAmounts,
} from "@/lib/payments/submit";
import type { BulkPaymentEntryInput } from "@/types/rdash";
import type {
  AllocationRow,
  BulkSubmitRequest,
  BulkSubmitResult,
  PaymentHeader as PaymentHeaderValue,
} from "@/types/payments";
import { PaymentHeader } from "./components/PaymentHeader";
import { SummaryCards } from "./components/SummaryCards";
import { AllocationTable, TableBox, TableSkeleton } from "./components/AllocationTable";
import { EmptyState, LoadError } from "./components/EmptyState";
import { ValidationList } from "./components/ValidationList";
import { PayloadPreview } from "./components/PayloadPreview";
import { SubmitResult, type SubmitOutcome } from "./components/SubmitResult";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/** What was sent, kept for the payload preview and Retry failed. */
interface Sent {
  request: BulkSubmitRequest;
  entries: BulkPaymentEntryInput[];
}

const EMPTY_HEADER: PaymentHeaderValue = {
  amountPaid: "",
  paymentDate: "",
  paymentMode: null,
  reference: "",
  remark: "",
};

const BULK_URL = "/api/rdash/payment-entries/bulk";
const LOAD_ERROR = "Could not load payment requests. Please try again.";
const SUBMIT_UNKNOWN =
  "Could not confirm whether the payments were recorded. Check Payment Entries in rDash before submitting again.";
const REFRESH_ERROR = "Payments were submitted, but the table could not be refreshed.";
const SESSION_EXPIRED_TEXT = "Your session expired. Signing in again…";

// sessionStorage for the unsaved-form draft; null when the browser blocks it.
function draftStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const errorText = (body: unknown, fallback: string): string =>
  body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : fallback;

async function fetchRows(): Promise<{ ok: true; rows: AllocationRow[] } | { ok: false; message: string }> {
  try {
    const res = await apiFetch("/api/rdash/payment-requests", { cache: "no-store" });
    // 401: apiFetch is already navigating to a fresh handover.
    if (res.status === 401) return { ok: false, message: SESSION_EXPIRED_TEXT };
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: errorText(body, LOAD_ERROR) };
    const list = body && typeof body === "object" ? (body as { rows?: unknown }).rows : undefined;
    if (!Array.isArray(list)) {
      console.error("[new-payment] unexpected /api/rdash/payment-requests body");
      return { ok: false, message: LOAD_ERROR };
    }
    return { ok: true, rows: list as AllocationRow[] };
  } catch (err) {
    console.error("[new-payment] load failed", err);
    return { ok: false, message: LOAD_ERROR };
  }
}

// /payments/new — header, summary, allocation table, live validation, submit.
// Every calculation / rule comes from lib/payments; this component only
// holds state and wires events.
export function NewPaymentClient() {
  const router = useRouter();
  const { buildUrl, dataSource, vendorId } = useSession();
  const { confirm } = useUI();

  const [header, setHeader] = useState<PaymentHeaderValue>(EMPTY_HEADER);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  // Currency filter: the user's explicit pick (code). The effective selection
  // is derived during render (resolveSelectedCurrency): their pick if it still
  // exists, else the only currency, else none — never guessed.
  const [pickedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);
  // Header fields the user has edited: their inline errors show; the live
  // list under the table shows everything once the form is dirty.
  const [touched, setTouched] = useState<Set<keyof PaymentHeaderValue>>(() => new Set());

  // ── Submit state ──
  // Single-flight: the ref blocks a second submit before React re-renders;
  // `submitting` drives the disabled button + spinner.
  const inFlightRef = useRef(false);
  const [submitting, setSubmitting] = useState<"submit" | "retry" | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  // The request that produced the current partial result (for Retry failed).
  const [resultSent, setResultSent] = useState<{ sent: Sent; result: BulkSubmitResult } | null>(null);
  const [lastSent, setLastSent] = useState<Sent | null>(null);
  const [serverRowErrors, setServerRowErrors] = useState<Record<number, string>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Failed ids the user removed (shown as "Removed" in the result panel).
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());

  // Latest header remark for rows arriving after the user typed one.
  const headerRemarkRef = useRef(header.remark);
  headerRemarkRef.current = header.remark;

  const loadRows = useCallback(async () => {
    setLoad({ status: "loading" });
    const r = await fetchRows();
    if (!r.ok) {
      setLoad({ status: "error", message: r.message });
      return;
    }
    setRows(applyHeaderRemark(r.rows, headerRemarkRef.current));
    setLoad({ status: "ready" });
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Currency rules live in lib/payments/currency.ts. Everything below the
  // filter (table, totals, validation, submit) uses ONLY the rows of the
  // selected currency.
  const currencyOptions = useMemo(() => listCurrencies(rows), [rows]);
  const selectedCurrency = resolveSelectedCurrency(currencyOptions, pickedCurrency);
  const selectedOption = currencyOptions.find((o) => o.code === selectedCurrency) ?? null;
  const visibleRows = useMemo(() => rowsForCurrency(rows, selectedCurrency), [rows, selectedCurrency]);
  const noCurrencyCount = useMemo(() => rowsWithoutCurrency(rows), [rows]);
  const needsCurrencyPick = load.status === "ready" && currencyOptions.length > 0 && !selectedOption;
  const totals = useMemo(() => computeTotals(header.amountPaid, visibleRows), [header.amountPaid, visibleRows]);
  const currency = useMemo(() => ({ symbol: selectedOption?.symbol || null, mixed: false }), [selectedOption]);
  const validation = useMemo(() => validateAllocation(header, visibleRows), [header, visibleRows]);

  // ── Session expiry (re-handover) ──
  // Latest form state for the save hook below (it runs outside React).
  const draftSourceRef = useRef({ vendorId, currency: selectedCurrency, header, rows });
  draftSourceRef.current = { vendorId, currency: selectedCurrency, header, rows };
  // apiFetch calls this right before leaving the page for a fresh handover.
  useEffect(
    () =>
      onBeforeRehandover(() => {
        const s = draftSourceRef.current;
        const draft = buildDraft(s.vendorId, s.currency, s.header, s.rows);
        const store = draftStorage();
        if (draft && store) saveDraft(store, draft);
      }),
    [],
  );
  // Back from the handover: restore the saved form once, into rows that
  // still exist, then the draft is gone (takeDraft deletes it).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || load.status !== "ready" || !vendorId) return;
    restoredRef.current = true;
    const store = draftStorage();
    const draft = store ? takeDraft(store, vendorId) : null;
    if (!draft) return;
    setHeader(draft.header);
    setRows((rs) => applyDraftRows(rs, draft));
    if (draft.currency) setSelectedCurrency(draft.currency);
    setTouched(
      new Set(
        (Object.keys(draft.header) as (keyof PaymentHeaderValue)[]).filter(
          (k) => draft.header[k] !== "" && draft.header[k] !== null,
        ),
      ),
    );
    setDirty(true);
  }, [load.status, vendorId]);

  const current = useMemo<Sent | null>(
    () =>
      validation.ok
        ? { request: buildSubmitRequest(header, validation.value), entries: buildBulkEntries(validation.value) }
        : null,
    [validation, header],
  );

  // Client errors first; a server 400 message shows on rows the client
  // considers valid.
  const rowErrors = useMemo(() => {
    const out: Record<number, Record<string, string>> = {};
    for (const [i, msg] of Object.entries(serverRowErrors)) out[Number(i)] = { amount: msg };
    for (const [i, fields] of Object.entries(validation.errors.rows)) out[Number(i)] = fields;
    return out;
  }, [serverRowErrors, validation.errors.rows]);

  const edited = () => {
    setDirty(true);
    setServerRowErrors((e) => (Object.keys(e).length ? {} : e));
  };
  const setHeaderField = <K extends keyof PaymentHeaderValue>(field: K, value: PaymentHeaderValue[K]) => {
    if (inFlightRef.current) return;
    edited();
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)));
    setHeader((h) => ({ ...h, [field]: value }));
    if (field === "remark") setRows((r) => applyHeaderRemark(r, value as string));
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

  // Refetch after every response so Payment Due is current, then merge the
  // user's state (lib/payments/submit.ts).
  const refreshAfter = async (result: BulkSubmitResult | null, fullSuccess: boolean) => {
    const r = await fetchRows();
    if (!r.ok) {
      setRefreshError(REFRESH_ERROR);
      return;
    }
    setRefreshError(null);
    setRows((prev) => {
      const merged = mergeRowsAfterSubmit(prev, r.rows, result);
      return fullSuccess ? applyHeaderRemark(merged, "") : merged;
    });
  };

  const send = async (sent: Sent, kind: "submit" | "retry") => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(kind);
    setOutcome(null);
    setServerRowErrors({});
    setRemovedIds(new Set());
    setLastSent(sent);
    const labels = new Map(
      rows.map((r) => [
        r.config.payment_request_id,
        { requestNumber: r.details?.request_number ?? null, projectName: r.projectName },
      ]),
    );
    let result: BulkSubmitResult | null = null;
    let fullSuccess = false;
    let sessionExpired = false;
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
      // 401: apiFetch saved the form and is navigating to a fresh handover.
      // The submit is NOT re-sent — the user submits again from the restored
      // form (a payment rDash already recorded shows as paid after reload).
      if (res.status === 401) {
        sessionExpired = true;
        return;
      }
      const body: unknown = await res.json().catch(() => null);

      if (res.ok && isBulkSubmitResult(body)) {
        result = body;
        const store = draftStorage();
        if (store) clearDraft(store, vendorId);
        fullSuccess = body.failed.length === 0;
        setOutcome({ kind: "result", result: body, amounts: sentAmounts(sent.request), labels, symbol: selectedOption?.symbol || null });
        if (fullSuccess) {
          setResultSent(null);
          setHeader(EMPTY_HEADER);
          setTouched(new Set());
          setDirty(false);
        } else {
          setResultSent({ sent, result: body });
          // Amount Paid becomes the not-recorded amount (same rule Retry uses).
          setHeader((h) => ({ ...h, amountPaid: retryAmountPaid(body, sent.request) }));
        }
      } else if (res.status === 400 && isValidationRejection(body)) {
        setServerRowErrors(mapServerRowErrors(sent.request, body.fieldErrors, visibleRows));
        setOutcome({ kind: "rejected", summary: body.summary });
      } else if (res.status === 403) {
        setOutcome({ kind: "error", message: errorText(body, "You do not have access to perform this action") });
      } else {
        // 502 (incl. "could not confirm") or an unexpected 200 body: outcome unknown.
        if (res.ok) console.error("[new-payment] unexpected bulk response body", body);
        setOutcome({ kind: "error", message: res.ok ? SUBMIT_UNKNOWN : errorText(body, SUBMIT_UNKNOWN) });
      }
    } finally {
      // Refetch after every response (and after a network error — the
      // submit may have reached rDash). Not after a 401: the page is leaving.
      if (!sessionExpired) await refreshAfter(result, fullSuccess);
      inFlightRef.current = false;
      setSubmitting(null);
    }
  };

  const onSubmit = () => {
    // Re-validate at click time from the latest state (never a stale render).
    const v = validateAllocation(header, visibleRows);
    if (!v.ok) return;
    void send({ request: buildSubmitRequest(header, v.value), entries: buildBulkEntries(v.value) }, "submit");
  };

  const onRetryFailed = () => {
    if (!resultSent) return;
    const { sent, result } = resultSent;
    // ONLY ids in failed[] (lib/payments/retry.ts).
    void send(
      { request: buildRetryRequest(result, sent.request), entries: buildRetryEntries(result, sent.entries) },
      "retry",
    );
  };

  // Remove a failed row: unlock it (lib rule) and drop it from Retry failed;
  // Amount paid follows what is still retryable.
  const onRemoveFailed = (index: number) => {
    if (inFlightRef.current) return;
    const row = visibleRows[index];
    if (!row?.rowError) return;
    const id = row.config.payment_request_id;
    edited();
    setRows((rs) => rs.map((r) => (r.config.payment_request_id === id ? dismissFailedRow(r) : r)));
    setRemovedIds((s) => new Set(s).add(id));
    if (resultSent) {
      const result = removeFailedId(resultSent.result, id);
      setResultSent({ sent: resultSent.sent, result });
      setHeader((h) => ({ ...h, amountPaid: retryAmountPaid(result, resultSent.sent.request) }));
    }
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
    setSelectedCurrency(code);
  };

  const onCancel = async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard this payment?",
        message: "The amounts and details you entered will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        variant: "danger",
      });
      if (!ok) return;
    }
    router.push(buildUrl("/payments"));
  };

  const headerErrors = Object.fromEntries(
    Object.entries(validation.errors.header).filter(([f]) => touched.has(f as keyof PaymentHeaderValue)),
  );
  const preview = current ? { label: "will be sent", sent: current } : lastSent ? { label: "last sent", sent: lastSent } : null;

  return (
    <>
      <PageHeader
        actions={
          <CurrencyFilter
            options={currencyOptions}
            selected={selectedOption?.code ?? null}
            onSelect={(code) => void onCurrencyChange(code)}
            disabled={submitting !== null || load.status !== "ready"}
          />
        }
      />
      <main className="flex flex-1 flex-col gap-5 p-5">
        {/* Disabled while a submit is in flight — no edits can race the response. */}
        <fieldset disabled={submitting !== null} aria-busy={submitting !== null} className="flex min-w-0 flex-col gap-5">
          <PaymentHeader value={header} errors={headerErrors} onChange={setHeaderField} />
          <SummaryCards
            totals={totals}
            loaded={load.status === "ready" && selectedOption !== null}
            rowCount={visibleRows.length}
            currency={currency}
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
            }
            footer={
              <>
                <button type="button" className={rdButtonPrimary} disabled={!validation.ok || submitting !== null} onClick={onSubmit}>
                  {submitting === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {submitting === "submit" ? "Submitting…" : "Submit payments"}
                </button>
                <button type="button" className={rdButtonOutline} disabled={submitting !== null} onClick={() => void onCancel()}>
                  Cancel
                </button>
              </>
            }
          >
            {load.status === "loading" && <TableSkeleton />}
            {load.status === "error" && <LoadError message={load.message} onRetry={() => void loadRows()} />}
            {load.status === "ready" && rows.length === 0 && <EmptyState />}
            {needsCurrencyPick && <EmptyState message="Select a currency to see payment requests" />}
            {load.status === "ready" && visibleRows.length > 0 && (
              <AllocationTable
                currencySymbol={currency.symbol}
                rows={visibleRows}
                rowErrors={rowErrors}
                onAmount={(i, v) => updateRow(i, (r) => setRowAmount(r, v))}
                onPayInFull={(i) => updateRow(i, payInFull)}
                onRemark={(i, v) => updateRow(i, (r) => setRowRemark(r, v))}
                onRemove={onRemoveFailed}
              />
            )}
          </TableBox>

          {load.status === "ready" && noCurrencyCount > 0 ? (
            <p className="text-[12px] text-rd-pending">
              {noCurrencyCount} request{noCurrencyCount === 1 ? " has" : "s have"} no currency from rDash and can&apos;t be shown.
            </p>
          ) : null}
          {load.status === "ready" && visibleRows.length > 0 && dirty ? <ValidationList items={validation.summary} /> : null}
        </fieldset>

        {refreshError ? (
          <div className={rdCard}>
            <LoadError message={refreshError} onRetry={() => void refreshAfter(null, false)} />
          </div>
        ) : null}
        {outcome ? (
          <SubmitResult
            outcome={outcome}
            retrying={submitting === "retry"}
            busy={submitting !== null}
            canRetry={(resultSent?.result.failed.length ?? 0) > 0}
            removed={removedIds}
            onRetryFailed={onRetryFailed}
          />
        ) : null}
        {dataSource === "mock" && preview ? (
          <PayloadPreview label={preview.label} request={preview.sent.request} entries={preview.sent.entries} />
        ) : null}
      </main>
    </>
  );
}
