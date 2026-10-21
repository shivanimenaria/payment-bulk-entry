"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { listCurrencies, resolveSelectedCurrency, rowsForCurrency, rowsWithoutCurrency } from "@/lib/payments/currency";
import { currencyFromSearch } from "@/lib/payments/payment-form";
import type { VendorPaymentSummaries } from "@/lib/payments/summary";
import type { AllocationRow } from "@/types/payments";

export const LOAD_ERROR = "Could not load payment requests. Please try again.";
const SESSION_EXPIRED_TEXT = "Your session expired. Signing in again…";

export const errorText = (body: unknown, fallback: string): string =>
  body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : fallback;

export async function fetchRows(): Promise<
  { ok: true; rows: AllocationRow[]; summaries: VendorPaymentSummaries } | { ok: false; message: string }
> {
  try {
    const res = await apiFetch("/api/rdash/payment-requests", { cache: "no-store" });
    // 401: apiFetch is already navigating to a fresh handover.
    if (res.status === 401) return { ok: false, message: SESSION_EXPIRED_TEXT };
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: errorText(body, LOAD_ERROR) };
    const list = body && typeof body === "object" ? (body as { rows?: unknown }).rows : undefined;
    if (!Array.isArray(list)) {
      console.error("[payments] unexpected /api/rdash/payment-requests body");
      return { ok: false, message: LOAD_ERROR };
    }
    // Page-1 cards per currency (lib/payments/summary.ts). Missing / not an
    // object → no figures ("—"), never invented.
    const raw = (body as { summaries?: unknown }).summaries;
    const summaries = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as VendorPaymentSummaries) : {};
    return { ok: true, rows: list as AllocationRow[], summaries };
  } catch (err) {
    console.error("[payments] load failed", err);
    return { ok: false, message: LOAD_ERROR };
  }
}

export type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

// Shared by /payments and /payments/new: loads the session vendor's payable
// requests (latest load wins), and resolves the currency filter
// (lib/payments/currency.ts). The page's initial currency comes from
// `?currency=` (the other page's pick); it is only used if that currency
// exists in the rows — never guessed.
export function usePaymentRequests(opts: { prepare?: (rows: AllocationRow[]) => AllocationRow[] } = {}) {
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  // Bumped on every successful (re)load; with the currency it is the paging
  // reset key, so the table goes back to page 1 when either changes.
  const [loadSeq, setLoadSeq] = useState(0);
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<VendorPaymentSummaries>({});

  const prepareRef = useRef(opts.prepare);
  prepareRef.current = opts.prepare;

  // Only the latest load applies: an older response that arrives later
  // (double-mounted effect in dev, a second Retry click) must not overwrite
  // rows — e.g. a draft restored after the newer load.
  const loadReqRef = useRef(0);
  const loadRows = useCallback(async () => {
    const req = ++loadReqRef.current;
    setLoad({ status: "loading" });
    const r = await fetchRows();
    if (req !== loadReqRef.current) return;
    if (!r.ok) {
      setLoad({ status: "error", message: r.message });
      return;
    }
    setRows(prepareRef.current ? prepareRef.current(r.rows) : r.rows);
    setSummaries(r.summaries);
    setLoadSeq((n) => n + 1);
    setLoad({ status: "ready" });
  }, []);

  useEffect(() => {
    setPickedCurrency((c) => c ?? currencyFromSearch(window.location.search));
    void loadRows();
  }, [loadRows]);

  const currencyOptions = useMemo(() => listCurrencies(rows), [rows]);
  const selectedCurrency = resolveSelectedCurrency(currencyOptions, pickedCurrency);
  const selectedOption = currencyOptions.find((o) => o.code === selectedCurrency) ?? null;
  const visibleRows = useMemo(() => rowsForCurrency(rows, selectedCurrency), [rows, selectedCurrency]);
  const noCurrencyCount = useMemo(() => rowsWithoutCurrency(rows), [rows]);
  const needsCurrencyPick = load.status === "ready" && currencyOptions.length > 0 && !selectedOption;

  return {
    rows,
    /** Page-1 card figures for the selected currency, or null. */
    summary: (selectedCurrency && summaries[selectedCurrency]) || null,
    setRows,
    load,
    loadRows,
    loadSeq,
    bumpLoadSeq: () => setLoadSeq((n) => n + 1),
    setPickedCurrency,
    currencyOptions,
    selectedCurrency,
    selectedOption,
    visibleRows,
    noCurrencyCount,
    needsCurrencyPick,
  };
}
