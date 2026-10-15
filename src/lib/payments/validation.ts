// Shared (client + server) payment validation. Pure — no I/O, no React, no
// server-only. The SAME helpers back both entry points:
//   - validateAllocation(header, rows)   → client form (AllocationRow[])
//   - validateSubmission(body, config)   → bulk route (fresh server config)
// Shared rules live once: parseMoney/toPaise, validateHeader, checkRowAmount,
// the excess check and the message strings.
//
// Money is compared in integer paise so 0.1 + 0.2 style float drift can never
// let an over-payment through.
import type { PaymentMode, VendorPaymentRequestConfigItem } from "@/types/rdash";
import type { AllocationRow, PaymentHeader } from "@/types/payments";
import { computeTotals } from "./totals";
import { toPaise, rowAmountPaise } from "./money";

// Money helpers live in money.ts (shared with totals.ts); re-exported so
// existing imports from "validation" keep working.
export { toPaise, fromPaise, paiseToInput, rowAmountPaise } from "./money";

export const PAYMENT_MODES: readonly PaymentMode[] = ["bank_transfer", "cheque", "cash", "upi"];

export const MESSAGES = {
  amountPositive: "Enter an amount greater than 0 with at most 2 decimals",
  amountFormat: "Enter an amount with at most 2 decimals",
  amountOverDue: "Amount is more than the payment due",
  paymentDate: "Enter a valid payment date",
  paymentMode: "Select a payment mode",
  reference: "Invalid reference",
  remark: "Invalid remark",
  missingRequest: "Missing payment request",
  duplicateRequest: "Duplicate payment request",
  unknownRequest: "Unknown payment request for this vendor",
  nothingDue: "Nothing is due on this payment request",
  detailsUnavailable: "Details pending — this request can't be paid yet",
  detailsError: "Details could not be loaded — this request can't be paid",
  headerRequired: "Header is required",
  noRows: "At least one payment row is required",
  noSelection: "Enter a payment for at least one request",
  excess: "Allocated total must equal Amount Paid",
} as const;

/** "YYYY-MM-DD" and a real calendar date. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface HeaderInput {
  amountPaid: unknown;
  paymentDate: unknown;
  paymentMode: unknown;
  reference: unknown;
  remark: unknown;
}

export interface RowInput {
  payment_request_id: unknown;
  amount: unknown;
  remark: unknown;
}

export interface FieldErrors {
  /** Whole-submission errors (e.g. totals). */
  form: string[];
  header: Record<string, string>;
  /** Keyed by the row's index in the validated rows array. */
  rows: Record<number, Record<string, string>>;
}

export interface ValidatedSubmission {
  amountPaidPaise: number;
  paymentDate: string;
  paymentMode: PaymentMode;
  reference: string | null;
  /** Only rows with an amount > 0, in input order. */
  rows: { payment_request_id: string; amountPaise: number; remark: string | null }[];
}

export type ValidationResult =
  | { ok: true; value: ValidatedSubmission; errors: FieldErrors; summary: string[] }
  | { ok: false; errors: FieldErrors; summary: string[] };

const optionalText = (v: unknown): { ok: boolean; value: string | null } => {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, value: null };
  const t = v.trim();
  return { ok: true, value: t ? t : null };
};

const emptyErrors = (): FieldErrors => ({ form: [], header: {}, rows: {} });

// ── Shared rules ─────────────────────────────────────────────

export interface ValidatedHeader {
  amountPaidPaise: number;
  paymentDate: string;
  paymentMode: PaymentMode;
  reference: string | null;
}

/** Header: amountPaid > 0 (≤ 2 decimals), paymentDate, paymentMode required;
 *  reference / remark optional text. */
export function validateHeader(h: Partial<HeaderInput>): { errors: Record<string, string>; value: ValidatedHeader | null } {
  const errors: Record<string, string> = {};
  const amountPaidPaise = toPaise(h.amountPaid);
  if (amountPaidPaise === null || amountPaidPaise <= 0) errors.amountPaid = MESSAGES.amountPositive;
  if (!isValidDate(h.paymentDate)) errors.paymentDate = MESSAGES.paymentDate;
  if (typeof h.paymentMode !== "string" || !PAYMENT_MODES.includes(h.paymentMode as PaymentMode)) {
    errors.paymentMode = MESSAGES.paymentMode;
  }
  const reference = optionalText(h.reference);
  if (!reference.ok) errors.reference = MESSAGES.reference;
  if (!optionalText(h.remark).ok) errors.remark = MESSAGES.remark;
  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      amountPaidPaise: amountPaidPaise as number,
      paymentDate: h.paymentDate as string,
      paymentMode: h.paymentMode as PaymentMode,
      reference: reference.value,
    },
  };
}

/** Amount vs. due. `amountPaise` null = malformed. Zero is allowed only when
 *  `allowZero` (client: an empty/0 row is simply not selected). */
export function checkRowAmount(
  amountPaise: number | null,
  duePaise: number | null,
  opts: { allowZero: boolean },
): string | null {
  if (amountPaise === null) return opts.allowZero ? MESSAGES.amountFormat : MESSAGES.amountPositive;
  if (amountPaise === 0) return opts.allowZero ? null : MESSAGES.amountPositive;
  if (duePaise !== null && duePaise > 0 && amountPaise > duePaise) return MESSAGES.amountOverDue;
  return null;
}

/** Excess = Amount Paid − Allocated must be exactly 0. */
export function checkExcess(amountPaidPaise: number, allocatedPaise: number): string | null {
  return amountPaidPaise - allocatedPaise === 0 ? null : MESSAGES.excess;
}

const HEADER_LABELS: Record<string, string> = {
  amountPaid: "Amount paid",
  paymentDate: "Payment date",
  paymentMode: "Payment mode",
  reference: "Reference / UTR",
  remark: "Remark",
};

/** Flat, human-readable list of every error (for a banner / toast). */
export function summarizeErrors(errors: FieldErrors, rowLabel: (index: number) => string): string[] {
  const out = [...errors.form];
  for (const [field, msg] of Object.entries(errors.header)) out.push(`${HEADER_LABELS[field] ?? field}: ${msg}`);
  for (const [i, fields] of Object.entries(errors.rows)) {
    for (const msg of Object.values(fields)) out.push(`${rowLabel(Number(i))}: ${msg}`);
  }
  return out;
}

function finish(errors: FieldErrors, summary: string[], value: ValidatedSubmission | null): ValidationResult {
  const failed = errors.form.length > 0 || Object.keys(errors.header).length > 0 || Object.keys(errors.rows).length > 0;
  return failed || !value ? { ok: false, errors, summary } : { ok: true, value, errors, summary };
}

// ── Client: the allocation form ──────────────────────────────

/**
 * Validate the form before submit. Rows keyed by their index in `rows`.
 *  - Row amount ≥ 0 ("" = 0), ≤ 2 decimals, ≤ payment_due.
 *  - A row with detailsUnavailable or detailsError cannot have an amount > 0.
 *  - At least one row with amount > 0.
 *  - Excess (Amount Paid − Allocated) must be exactly 0.
 * (rowError — a previous bulk failure — does NOT block: failed rows keep
 * their amounts for Retry failed.)
 */
export function validateAllocation(header: PaymentHeader, rows: AllocationRow[]): ValidationResult {
  const errors = emptyErrors();
  const h = validateHeader(header);
  errors.header = h.errors;

  const selected: ValidatedSubmission["rows"] = [];
  rows.forEach((row, i) => {
    const amountPaise = rowAmountPaise(row.amount);
    const duePaise = toPaise(row.config.payment_due);
    let msg = checkRowAmount(amountPaise, duePaise, { allowZero: true });
    if (!msg && amountPaise !== null && amountPaise > 0) {
      if (row.detailsUnavailable) msg = MESSAGES.detailsUnavailable;
      else if (row.detailsError) msg = MESSAGES.detailsError;
      else if (duePaise === null || duePaise <= 0) msg = MESSAGES.nothingDue;
    }
    if (msg) {
      errors.rows[i] = { amount: msg };
      return;
    }
    if (amountPaise !== null && amountPaise > 0) {
      const remark = optionalText(row.remark).value;
      selected.push({ payment_request_id: row.config.payment_request_id, amountPaise, remark });
    }
  });

  const hasRowErrors = Object.keys(errors.rows).length > 0;
  if (!hasRowErrors && selected.length === 0) errors.form.push(MESSAGES.noSelection);
  if (h.value && !hasRowErrors && selected.length > 0) {
    const totals = computeTotals(header.amountPaid, rows);
    const excess = checkExcess(h.value.amountPaidPaise, totals.allocatedPaise);
    if (excess) errors.form.push(excess);
  }

  const label = (i: number) => {
    const r = rows[i];
    return `Row ${i + 1}${r?.details?.request_number ? ` (${r.details.request_number})` : ""}`;
  };
  const summary = summarizeErrors(errors, label);
  return finish(errors, summary, h.value ? { ...h.value, rows: selected } : null);
}

// ── Server: the bulk route ───────────────────────────────────

/**
 * Validate a bulk submission against the FRESH config for the session vendor.
 * Only `payment_request_id`, `amount`, `remark` are read from each row — any
 * client-sent payment_due / amount due / vendor is ignored. Every submitted
 * row must have amount > 0. Any problem in any row rejects the whole
 * submission. Rows keyed by their index in `body.rows`.
 */
export function validateSubmission(
  body: { header?: unknown; rows?: unknown },
  freshConfig: VendorPaymentRequestConfigItem[],
): ValidationResult {
  const errors = emptyErrors();
  const rowErr = (i: number, field: string, msg: string) => {
    (errors.rows[i] ??= {})[field] = msg;
  };

  const headerObj = body.header && typeof body.header === "object" ? (body.header as Partial<HeaderInput>) : null;
  if (!headerObj) errors.form.push(MESSAGES.headerRequired);
  const h = validateHeader(headerObj ?? {});
  errors.header = h.errors;

  const byId = new Map(freshConfig.map((c) => [c.payment_request_id, c]));
  const seen = new Set<string>();
  const rows: ValidatedSubmission["rows"] = [];
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    errors.form.push(MESSAGES.noRows);
  } else {
    body.rows.forEach((raw, i) => {
      const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RowInput>;
      const id = typeof r.payment_request_id === "string" ? r.payment_request_id : "";
      let rowOk = true;
      if (!id) {
        rowErr(i, "payment_request_id", MESSAGES.missingRequest);
        rowOk = false;
      } else if (seen.has(id)) {
        rowErr(i, "payment_request_id", MESSAGES.duplicateRequest);
        rowOk = false;
      } else {
        seen.add(id);
      }
      const cfg = id ? byId.get(id) : undefined;
      if (id && !cfg) {
        rowErr(i, "payment_request_id", MESSAGES.unknownRequest);
        rowOk = false;
      }
      const duePaise = cfg ? toPaise(cfg.payment_due) : null;
      if (cfg && (duePaise === null || duePaise <= 0)) {
        rowErr(i, "payment_request_id", MESSAGES.nothingDue);
        rowOk = false;
      }
      const amountPaise = toPaise(r.amount);
      const amountMsg = checkRowAmount(amountPaise, duePaise, { allowZero: false });
      if (amountMsg) {
        rowErr(i, "amount", amountMsg);
        rowOk = false;
      }
      const remark = optionalText(r.remark);
      if (!remark.ok) {
        rowErr(i, "remark", MESSAGES.remark);
        rowOk = false;
      }
      if (rowOk && amountPaise !== null) {
        rows.push({ payment_request_id: id, amountPaise, remark: remark.value });
      }
    });
  }

  const hasRowErrors = Object.keys(errors.rows).length > 0;
  if (h.value && !hasRowErrors && rows.length > 0) {
    const excess = checkExcess(
      h.value.amountPaidPaise,
      rows.reduce((s, r) => s + r.amountPaise, 0),
    );
    if (excess) errors.form.push(excess);
  }

  const submitted = Array.isArray(body.rows) ? body.rows : [];
  const label = (i: number) => {
    const id = (submitted[i] as Partial<RowInput> | undefined)?.payment_request_id;
    return `Row ${i + 1}${typeof id === "string" && id ? ` (${id})` : ""}`;
  };
  return finish(errors, summarizeErrors(errors, label), h.value ? { ...h.value, rows } : null);
}
