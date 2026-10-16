// Paise-safe money helpers. Pure; shared by validation, totals, retry and the
// client. All arithmetic on money happens in integer paise.

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

/** Paise → plain decimal string for an input / request body (120050 → "1200.5", 100 → "1"). */
export const paiseToInput = (paise: number): string => {
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
};

/** A row's Payment Done input: "" (or whitespace) means "not paying this row" = 0. */
export function rowAmountPaise(amount: unknown): number | null {
  if (typeof amount === "string" && amount.trim() === "") return 0;
  return toPaise(amount);
}

// ── rDash amounts ─────────────────────────────────────────────
// rDash sends money as DECIMAL STRINGS with up to 4 decimals ("29500.0000",
// "0", "0.0", "11.0000"); some fields may still be JSON numbers. Converted to
// integer paise only when every digit beyond the 2nd decimal is zero — a
// sub-paisa value ("12.3456") or anything that isn't a plain non-negative
// decimal is INVALID (never rounded). Values beyond Number.MAX_SAFE_INTEGER
// paise are TOO LARGE (e.g. "2000000000000000000000000000.0000").
export type RdashAmountResult =
  | { ok: true; paise: number }
  | { ok: false; reason: "invalid" | "too_large" };

const RDASH_DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Canonical decimal text for an rDash amount (string as-is; finite number via String). */
function rdashAmountText(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const s = String(value);
    return /e/i.test(s) ? null : s;
  }
  return null;
}

export function parseRdashAmount(value: unknown): RdashAmountResult {
  const text = rdashAmountText(value);
  const m = text === null ? null : RDASH_DECIMAL_RE.exec(text);
  if (!m) return { ok: false, reason: "invalid" };
  const [, whole, frac = ""] = m;
  if (/[1-9]/.test(frac.slice(2))) return { ok: false, reason: "invalid" }; // sub-paisa digits
  const paise = BigInt(whole) * BigInt(100) + BigInt(frac.slice(0, 2).padEnd(2, "0"));
  if (paise > MAX_SAFE) return { ok: false, reason: "too_large" };
  return { ok: true, paise: Number(paise) };
}

/** Paise of an rDash amount, or null when invalid / too large. */
export function rdashPaise(value: unknown): number | null {
  const r = parseRdashAmount(value);
  return r.ok ? r.paise : null;
}

/** Paise → rDash's decimal-string form ("29500.0000"), e.g. for mock data. */
export function paiseToRdash(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = String(paise % 100).padStart(2, "0");
  return `${whole}.${frac}00`;
}
