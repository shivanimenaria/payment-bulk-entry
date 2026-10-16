"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { useUI } from "@/components/ui/toast-confirm";
import { apiFetch } from "@/lib/api-fetch";
import { useSession } from "@/lib/auth-context";
import { validateAllocation } from "@/lib/payments/validation";
import { computeTotals } from "@/lib/payments/totals";
import { applyHeaderRemark, setRowRemark } from "@/lib/payments/remarks";
import { clearAppliedAmounts, payInFull, setRowAmount } from "@/lib/payments/allocation";
import { buildBulkEntries } from "@/lib/payments/build-payload";
import type { AllocationRow, PaymentHeader as PaymentHeaderValue } from "@/types/payments";
import { PaymentHeader } from "./components/PaymentHeader";
import { SummaryCards } from "./components/SummaryCards";
import { AllocationTable, TableSkeleton } from "./components/AllocationTable";
import { EmptyState, LoadError } from "./components/EmptyState";
import { ValidationList } from "./components/ValidationList";
import { PayloadPreview } from "./components/PayloadPreview";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

const EMPTY_HEADER: PaymentHeaderValue = {
  amountPaid: "",
  paymentDate: "",
  paymentMode: null,
  reference: "",
  remark: "",
};

const LOAD_ERROR = "Could not load payment requests. Please try again.";

// /payments/new — header, summary, allocation table, live validation.
// Every calculation / rule comes from lib/payments; this component only
// holds state and wires events.
export function NewPaymentClient() {
  const router = useRouter();
  const { buildUrl, dataSource } = useSession();
  const { confirm } = useUI();

  const [header, setHeader] = useState<PaymentHeaderValue>(EMPTY_HEADER);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);
  // Header fields the user has edited: their inline errors show; the live
  // list under the table shows everything once the form is dirty.
  const [touched, setTouched] = useState<Set<keyof PaymentHeaderValue>>(() => new Set());

  // Latest header remark for rows arriving after the user typed one.
  const headerRemarkRef = useRef(header.remark);
  headerRemarkRef.current = header.remark;

  const loadRows = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await apiFetch("/api/rdash/payment-requests", { cache: "no-store" });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : LOAD_ERROR;
        setLoad({ status: "error", message: msg });
        return;
      }
      const list = body && typeof body === "object" ? (body as { rows?: unknown }).rows : undefined;
      if (!Array.isArray(list)) {
        console.error("[new-payment] unexpected /api/rdash/payment-requests body");
        setLoad({ status: "error", message: LOAD_ERROR });
        return;
      }
      setRows(applyHeaderRemark(list as AllocationRow[], headerRemarkRef.current));
      setLoad({ status: "ready" });
    } catch (err) {
      console.error("[new-payment] load failed", err);
      setLoad({ status: "error", message: LOAD_ERROR });
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const totals = useMemo(() => computeTotals(header.amountPaid, rows), [header.amountPaid, rows]);
  const validation = useMemo(() => validateAllocation(header, rows), [header, rows]);
  const entries = useMemo(() => (validation.ok ? buildBulkEntries(validation.value) : null), [validation]);

  const setHeaderField = <K extends keyof PaymentHeaderValue>(field: K, value: PaymentHeaderValue[K]) => {
    setDirty(true);
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)));
    setHeader((h) => ({ ...h, [field]: value }));
    if (field === "remark") setRows((r) => applyHeaderRemark(r, value as string));
  };
  const updateRow = (index: number, fn: (r: AllocationRow) => AllocationRow) => {
    setDirty(true);
    setRows((rs) => rs.map((r, i) => (i === index ? fn(r) : r)));
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

  // TODO(next step): submit flow — single-flight POST /api/rdash/payment-entries/bulk
  // (buildSubmitRequest), result panel (created / failed, "₹X recorded, ₹Y NOT
  // recorded"), rowError on failed rows, Retry failed (buildRetryRequest), refetch.
  const onSubmit = () => {};

  const showErrors = dirty;
  const headerErrors = Object.fromEntries(
    Object.entries(validation.errors.header).filter(([f]) => touched.has(f as keyof PaymentHeaderValue)),
  );

  return (
    <>
      <PageHeader title="Bulk payment entry" actions={<span className="text-xs font-medium text-gray-500">Currency: INR</span>} />
      <main className="flex flex-1 flex-col gap-4 p-6 pb-24">
        <PaymentHeader value={header} errors={headerErrors} onChange={setHeaderField} />
        <SummaryCards totals={totals} loaded={load.status === "ready"} />

        <section aria-label="Payment due" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Payment due
              <span className="ml-1 font-normal text-gray-500">
                · {totals.selectedCount} of {rows.length} selected
              </span>
            </h2>
            <button
              type="button"
              disabled={load.status !== "ready" || totals.selectedCount === 0}
              onClick={() => {
                setDirty(true);
                setRows((r) => clearAppliedAmounts(r));
              }}
              className="text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
            >
              Clear applied amount
            </button>
          </div>

          {load.status === "loading" && <TableSkeleton />}
          {load.status === "error" && <LoadError message={load.message} onRetry={() => void loadRows()} />}
          {load.status === "ready" && rows.length === 0 && <EmptyState />}
          {load.status === "ready" && rows.length > 0 && (
            <AllocationTable
              rows={rows}
              rowErrors={validation.errors.rows}
              onAmount={(i, v) => updateRow(i, (r) => setRowAmount(r, v))}
              onPayInFull={(i) => updateRow(i, payInFull)}
              onRemark={(i, v) => updateRow(i, (r) => setRowRemark(r, v))}
            />
          )}
        </section>

        {load.status === "ready" && rows.length > 0 && showErrors ? <ValidationList items={validation.summary} /> : null}
        {dataSource === "mock" && entries ? <PayloadPreview entries={entries} /> : null}
      </main>

      <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-gray-200 bg-white px-6 py-3">
        <Button size="sm" className="h-9 px-4" disabled={!validation.ok} onClick={onSubmit}>
          Submit payments
        </Button>
        <Button size="sm" variant="outline" className="h-9 px-4" onClick={() => void onCancel()}>
          Cancel
        </Button>
      </div>
    </>
  );
}
