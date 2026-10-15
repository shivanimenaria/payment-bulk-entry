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
