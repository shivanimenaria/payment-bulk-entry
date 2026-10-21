// Submit-flow rules (CLAUDE.md Key Rules → Submit / Partial failure /
// "Table refetches after every submit"). Pure; used by the client.
import type { AllocationRow, BulkSubmitRequest, BulkSubmitResult } from "@/types/payments";
import type { FieldErrors } from "./validation";
import { decimalUnits, userUnits, type Units } from "./money";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Shape check for the bulk route's 200 body. Anything else is treated as
 *  "outcome unknown" by the caller — never as success. */
export function isBulkSubmitResult(v: unknown): v is BulkSubmitResult {
  if (!isObj(v)) return false;
  const created = v.created;
  const failed = v.failed;
  return (
    typeof v.count === "number" &&
    decimalUnits(v.recordedAmount) !== null &&
    decimalUnits(v.notRecordedAmount) !== null &&
    Array.isArray(created) &&
    created.every((c) => isObj(c) && typeof c.payment_request_id === "string") &&
    Array.isArray(failed) &&
    failed.every((f) => isObj(f) && typeof f.payment_request_id === "string")
  );
}

/** Shape check for the bulk route's 400 body. */
export function isValidationRejection(v: unknown): v is { error: string; fieldErrors: FieldErrors; summary: string[] } {
  return (
    isObj(v) &&
    isObj(v.fieldErrors) &&
    Array.isArray((v.fieldErrors as Record<string, unknown>).form) &&
    isObj((v.fieldErrors as Record<string, unknown>).rows) &&
    Array.isArray(v.summary)
  );
}

/**
 * Merge the refetched rows (fresh Payment Due) with the user's state.
 *  - id in result.created → amount cleared, rowStatus "created".
 *  - id in result.failed  → keeps amount + remark, rowStatus "failed", rowError.
 *  - any other row        → keeps its amount / remark / override / status.
 * `result` null (rejected / unknown outcome) → every row keeps its state.
 * Rows no longer returned (e.g. fully paid → hidden) drop out.
 */
export function mergeRowsAfterSubmit(
  prev: AllocationRow[],
  fresh: AllocationRow[],
  result: BulkSubmitResult | null,
): AllocationRow[] {
  const byId = new Map(prev.map((r) => [r.config.payment_request_id, r]));
  const created = new Set(result?.created.map((c) => c.payment_request_id) ?? []);
  const failed = new Map(result?.failed.map((f) => [f.payment_request_id, f.error]) ?? []);
  return fresh.map((f) => {
    const id = f.config.payment_request_id;
    const p = byId.get(id);
    const kept = p ? { remark: p.remark, remarkOverridden: p.remarkOverridden } : {};
    if (created.has(id)) return { ...f, ...kept, amount: "", rowStatus: "created", rowError: null };
    if (failed.has(id)) {
      const error = failed.get(id);
      return {
        ...f,
        ...kept,
        amount: p?.amount ?? "",
        rowStatus: "failed",
        rowError: typeof error === "string" && error ? error : "Not recorded",
      };
    }
    if (!p) return f;
    return { ...f, ...kept, amount: p.amount, rowStatus: p.rowStatus, rowError: p.rowError };
  });
}

/** Map a 400's `fieldErrors.rows` (keyed by index in the SENT request) onto
 *  table rows (keyed by index in `rows`), one message per row. */
export function mapServerRowErrors(
  request: BulkSubmitRequest,
  fieldErrors: FieldErrors,
  rows: AllocationRow[],
): Record<number, string> {
  const tableIndex = new Map(rows.map((r, i) => [r.config.payment_request_id, i]));
  const out: Record<number, string> = {};
  for (const [sentIndex, fields] of Object.entries(fieldErrors.rows)) {
    const id = request.rows[Number(sentIndex)]?.payment_request_id;
    const i = id !== undefined ? tableIndex.get(id) : undefined;
    if (i === undefined) continue;
    out[i] = Object.values(fields).join("; ");
  }
  return out;
}

/** payment_request_id → amount sent (exact units), for the result lists. */
export function sentAmounts(request: BulkSubmitRequest): Map<string, Units> {
  const out = new Map<string, Units>();
  for (const r of request.rows) {
    const u = userUnits(r.amount);
    if (u !== null) out.set(r.payment_request_id, u);
  }
  return out;
}

export interface FailedPaymentLine {
  paymentRequestId: string;
  requestId: string;
  projectName: string;
  /** Amount that was sent for this request (exact units; null if unparseable). */
  amountUnits: Units | null;
  /** rDash's per-entry error (bulk `failed[].error`). */
  error: string;
}

/** "Some payments could not be recorded" popup: ONLY the failed entries, in
 *  rDash's order, labelled from the loaded rows. */
export function failedPaymentLines(
  result: Pick<BulkSubmitResult, "failed">,
  request: BulkSubmitRequest,
  rows: Pick<AllocationRow, "config" | "details" | "projectName">[],
): FailedPaymentLine[] {
  const amounts = sentAmounts(request);
  const byId = new Map(rows.map((r) => [r.config.payment_request_id, r]));
  return result.failed.map((f) => {
    const row = byId.get(f.payment_request_id);
    return {
      paymentRequestId: f.payment_request_id,
      requestId: row?.details?.request_number || "—",
      projectName: row?.projectName || "—",
      amountUnits: amounts.get(f.payment_request_id) ?? null,
      error: typeof f.error === "string" && f.error ? f.error : "—",
    };
  });
}

// ── Result popups after Submit (rDash success / warning prompts) ──

export interface PaymentTally {
  count: number;
  /** Exact units; null when the route's decimal string is unparseable. */
  amountUnits: Units | null;
}

/** What the Create Payment page shows after a bulk response it leaves on:
 *  every entry created → success prompt; some failed → partial prompt;
 *  502 / unexpected body → "could not confirm" prompt. */
export type SubmitPrompt =
  | { kind: "success"; recorded: PaymentTally; header: Pick<BulkSubmitRequest["header"], "paymentDate" | "paymentMode" | "reference"> }
  | { kind: "partial"; recorded: PaymentTally; notRecorded: PaymentTally; lines: FailedPaymentLine[] }
  | { kind: "unconfirmed" };

/** Prompt for a 200 bulk result (counts from created[] / failed[], amounts
 *  from the route's exact recorded / not-recorded strings). */
export function submitPromptFor(
  result: BulkSubmitResult,
  request: BulkSubmitRequest,
  rows: Pick<AllocationRow, "config" | "details" | "projectName">[],
): SubmitPrompt {
  const recorded = { count: result.created.length, amountUnits: decimalUnits(result.recordedAmount) };
  if (result.failed.length === 0) {
    const { paymentDate, paymentMode, reference } = request.header;
    return { kind: "success", recorded, header: { paymentDate, paymentMode, reference } };
  }
  return {
    kind: "partial",
    recorded,
    notRecorded: { count: result.failed.length, amountUnits: decimalUnits(result.notRecordedAmount) },
    lines: failedPaymentLines(result, request, rows),
  };
}
