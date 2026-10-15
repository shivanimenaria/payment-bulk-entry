// Shared (client + server) payment validation. Pure — no I/O, no server-only.
// MINIMAL VERSION: written for the bulk route ahead of the full payment-logic
// step; extend here (client wiring, totals) rather than duplicating rules.
//
// Money is compared in integer paise so 0.1 + 0.2 style float drift can never
// let an over-payment through.
import type { PaymentMode, VendorPaymentRequestConfigItem } from "@/types/rdash";

export const PAYMENT_MODES: readonly PaymentMode[] = ["bank_transfer", "cheque", "cash", "upi"];

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/** Parse a user/JSON money value into integer paise. Accepts a plain decimal
 *  string ("1200", "1200.5", "1200.50") or a finite number with at most 2
 *  decimals. Anything else (negative, exponent, >2 decimals, NaN) → null. */
export function toPaise(value: unknown): number | null {
  let str: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    str = String(value);
  } else if (typeof value === "string") {
    str = value.trim();
  } else {
    return null;
  }
  if (!MONEY_RE.test(str)) return null;
  const [whole, frac = ""] = str.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

export const fromPaise = (paise: number): number => paise / 100;

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
  /** Keyed by the row's index in the submitted `rows` array. */
  rows: Record<number, Record<string, string>>;
}

export interface ValidatedSubmission {
  amountPaidPaise: number;
  paymentDate: string;
  paymentMode: PaymentMode;
  reference: string | null;
  rows: { payment_request_id: string; amountPaise: number; remark: string | null }[];
}

const optionalText = (v: unknown): { ok: boolean; value: string | null } => {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, value: null };
  const t = v.trim();
  return { ok: true, value: t ? t : null };
};

/**
 * Validate a bulk submission against the FRESH config for the session vendor.
 * Only `payment_request_id`, `amount`, `remark` are read from each row — any
 * client-sent payment_due / amount due / vendor is ignored. Any problem in any
 * row rejects the whole submission.
 */
export function validateSubmission(
  body: { header?: unknown; rows?: unknown },
  freshConfig: VendorPaymentRequestConfigItem[],
): { ok: true; value: ValidatedSubmission } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = { form: [], header: {}, rows: {} };
  const rowErr = (i: number, field: string, msg: string) => {
    (errors.rows[i] ??= {})[field] = msg;
  };

  // ── Header ──
  const h = (body.header && typeof body.header === "object" ? body.header : {}) as Partial<HeaderInput>;
  if (!body.header || typeof body.header !== "object") errors.form.push("Header is required");
  const amountPaidPaise = toPaise(h.amountPaid);
  if (amountPaidPaise === null || amountPaidPaise <= 0) {
    errors.header.amountPaid = "Enter an amount greater than 0 with at most 2 decimals";
  }
  if (!isValidDate(h.paymentDate)) errors.header.paymentDate = "Enter a valid payment date";
  if (typeof h.paymentMode !== "string" || !PAYMENT_MODES.includes(h.paymentMode as PaymentMode)) {
    errors.header.paymentMode = "Select a payment mode";
  }
  const reference = optionalText(h.reference);
  if (!reference.ok) errors.header.reference = "Invalid reference";
  if (!optionalText(h.remark).ok) errors.header.remark = "Invalid remark";

  // ── Rows ──
  const byId = new Map(freshConfig.map((c) => [c.payment_request_id, c]));
  const seen = new Set<string>();
  const rows: ValidatedSubmission["rows"] = [];
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    errors.form.push("At least one payment row is required");
  } else {
    body.rows.forEach((raw, i) => {
      const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RowInput>;
      const id = typeof r.payment_request_id === "string" ? r.payment_request_id : "";
      let rowOk = true;
      if (!id) {
        rowErr(i, "payment_request_id", "Missing payment request");
        rowOk = false;
      } else if (seen.has(id)) {
        rowErr(i, "payment_request_id", "Duplicate payment request");
        rowOk = false;
      } else {
        seen.add(id);
      }
      const cfg = id ? byId.get(id) : undefined;
      if (id && !cfg) {
        rowErr(i, "payment_request_id", "Unknown payment request for this vendor");
        rowOk = false;
      }
      const duePaise = cfg ? toPaise(cfg.payment_due) : null;
      if (cfg && (duePaise === null || duePaise <= 0)) {
        rowErr(i, "payment_request_id", "Nothing is due on this payment request");
        rowOk = false;
      }
      const amountPaise = toPaise(r.amount);
      if (amountPaise === null || amountPaise <= 0) {
        rowErr(i, "amount", "Enter an amount greater than 0 with at most 2 decimals");
        rowOk = false;
      } else if (duePaise !== null && duePaise > 0 && amountPaise > duePaise) {
        rowErr(i, "amount", "Amount is more than the payment due");
        rowOk = false;
      }
      const remark = optionalText(r.remark);
      if (!remark.ok) {
        rowErr(i, "remark", "Invalid remark");
        rowOk = false;
      }
      if (rowOk && amountPaise !== null) {
        rows.push({ payment_request_id: id, amountPaise, remark: remark.value });
      }
    });
  }

  // ── Totals: Excess must be 0 ──
  const hasRowErrors = Object.keys(errors.rows).length > 0;
  if (amountPaidPaise !== null && !hasRowErrors && Array.isArray(body.rows) && body.rows.length > 0) {
    const used = rows.reduce((s, r) => s + r.amountPaise, 0);
    if (used !== amountPaidPaise) errors.form.push("Allocated total must equal Amount Paid");
  }

  if (errors.form.length || Object.keys(errors.header).length || hasRowErrors) return { ok: false, errors };
  return {
    ok: true,
    value: {
      amountPaidPaise: amountPaidPaise as number,
      paymentDate: h.paymentDate as string,
      paymentMode: h.paymentMode as PaymentMode,
      reference: reference.value,
      rows,
    },
  };
}
