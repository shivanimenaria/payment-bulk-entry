// Unsaved Create Payment state (/payments/new: payment form + table amounts
// + remarks + current table page), kept across a re-handover (CLAUDE.md
// "Embedding & Session" → session expiry). When the access token expires,
// apiFetch saves it to sessionStorage before the iframe navigates to
// /embedded/bootstrap?force=1&next=<current route>; /payments/new restores
// it once on load (only into rows that still exist) and deletes it. Pure apart from the storage helpers, which never throw
// (storage may be blocked or full).
import type { AllocationRow, PaymentHeader } from "@/types/payments";
import type { PaymentMode } from "@/types/rdash";
import { applyHeaderRemark, setRowRemark } from "./remarks";
import { setRowAmount } from "./allocation";

const KEY_PREFIX = "pbe:payment-draft:";
const PAYMENT_MODES: readonly PaymentMode[] = ["bank_transfer", "cheque", "cash", "upi"];

export interface DraftRow {
  payment_request_id: string;
  amount: string;
  remark: string;
  remarkOverridden: boolean;
}

/** Scoped to one vendor + currency; restored only for the same vendor. */
export interface PaymentDraft {
  vendorId: string;
  currency: string | null;
  /** Payment form (Remark = header remark). */
  header: PaymentHeader;
  rows: DraftRow[];
  /** Table page (1-based) the user was on. */
  page: number;
}

export const draftKey = (vendorId: string) => `${KEY_PREFIX}${vendorId}`;

/** The state worth keeping, or null when nothing was entered (no form field
 *  and no row with an amount or its own remark). Rows are keyed by
 *  payment_request_id. */
export function buildDraft(
  vendorId: string,
  currency: string | null,
  header: PaymentHeader,
  rows: AllocationRow[],
  page = 1,
): PaymentDraft | null {
  if (!vendorId) return null;
  const draftRows: DraftRow[] = rows
    .filter((r) => r.amount !== "" || r.remarkOverridden)
    .map((r) => ({
      payment_request_id: r.config.payment_request_id,
      amount: r.amount,
      remark: r.remark,
      remarkOverridden: r.remarkOverridden,
    }));
  const headerEntered =
    header.amountPaid !== "" ||
    header.paymentDate !== "" ||
    header.paymentMode !== null ||
    header.reference !== "" ||
    header.remark !== "";
  if (!headerEntered && draftRows.length === 0) return null;
  return { vendorId, currency, header: { ...header }, rows: draftRows, page: Number.isInteger(page) && page > 0 ? page : 1 };
}

/** Apply a draft to freshly loaded rows: the header Remark first, then each saved row's amount / remark by
 *  payment_request_id. Saved rows that no longer exist are dropped; amounts
 *  go through setRowAmount (locked rows stay untouched). */
export function applyDraftRows(rows: AllocationRow[], draft: PaymentDraft): AllocationRow[] {
  const byId = new Map(draft.rows.map((d) => [d.payment_request_id, d]));
  return applyHeaderRemark(rows, draft.header.remark).map((row) => {
    const saved = byId.get(row.config.payment_request_id);
    if (!saved) return row;
    let out = saved.remarkOverridden ? setRowRemark(row, saved.remark) : row;
    if (saved.amount !== "") out = setRowAmount(out, saved.amount);
    return out;
  });
}

const isStr = (v: unknown): v is string => typeof v === "string";

function parseHeader(v: unknown): PaymentHeader | undefined {
  const h = v as Record<string, unknown> | undefined;
  if (!h || typeof h !== "object") return undefined;
  if (!isStr(h.amountPaid) || !isStr(h.paymentDate) || !isStr(h.reference) || !isStr(h.remark)) return undefined;
  if (h.paymentMode !== null && !PAYMENT_MODES.includes(h.paymentMode as PaymentMode)) return undefined;
  return {
    amountPaid: h.amountPaid,
    paymentDate: h.paymentDate,
    paymentMode: h.paymentMode as PaymentMode | null,
    reference: h.reference,
    remark: h.remark,
  };
}

/** Shape check for what comes back out of storage (never trusted blindly).
 *  Anything else (incl. an older draft shape) → null (discarded). */
export function parseDraft(raw: unknown): PaymentDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!isStr(d.vendorId) || !d.vendorId) return null;
  if (d.currency !== null && !isStr(d.currency)) return null;
  const header = parseHeader(d.header);
  if (header === undefined) return null;
  if (!Number.isInteger(d.page) || (d.page as number) < 1) return null;
  if (!Array.isArray(d.rows)) return null;
  const rows: DraftRow[] = [];
  for (const r of d.rows as unknown[]) {
    const x = r as Record<string, unknown> | null;
    if (!x || !isStr(x.payment_request_id) || !isStr(x.amount) || !isStr(x.remark) || typeof x.remarkOverridden !== "boolean") {
      return null;
    }
    rows.push({
      payment_request_id: x.payment_request_id,
      amount: x.amount,
      remark: x.remark,
      remarkOverridden: x.remarkOverridden,
    });
  }
  return { vendorId: d.vendorId, currency: (d.currency as string | null) ?? null, header, rows, page: d.page as number };
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveDraft(storage: DraftStorage, draft: PaymentDraft): void {
  try {
    storage.setItem(draftKey(draft.vendorId), JSON.stringify(draft));
  } catch (err) {
    console.error("[payment-draft] could not save", err);
  }
}

/** Read and delete the vendor's draft (one restore only). */
export function takeDraft(storage: DraftStorage, vendorId: string): PaymentDraft | null {
  if (!vendorId) return null;
  try {
    const raw = storage.getItem(draftKey(vendorId));
    storage.removeItem(draftKey(vendorId));
    if (raw === null) return null;
    const draft = parseDraft(JSON.parse(raw));
    return draft && draft.vendorId === vendorId ? draft : null;
  } catch {
    return null;
  }
}

export function clearDraft(storage: DraftStorage, vendorId: string): void {
  if (!vendorId) return;
  try {
    storage.removeItem(draftKey(vendorId));
  } catch {
    // Storage unavailable — nothing was saved either.
  }
}
