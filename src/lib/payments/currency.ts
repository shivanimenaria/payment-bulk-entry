// Currency symbol for amount display, from the rows' rDash currency objects.
import type { AllocationRow } from "@/types/payments";

/** The single currency symbol of the rows, or null when rows are empty or
 *  mixed (mixed currencies can't be summed — CLAUDE.md Open Items). */
export function rowsCurrency(rows: Pick<AllocationRow, "config">[]): { symbol: string | null; mixed: boolean } {
  const symbols = new Set(rows.map((r) => r.config.currency?.symbol).filter((s): s is string => typeof s === "string" && s !== ""));
  if (symbols.size === 1) return { symbol: Array.from(symbols)[0], mixed: false };
  return { symbol: null, mixed: symbols.size > 1 };
}

// ── Currency filter (one vendor can have payable requests in several
//    currencies — real data: INR, USD, UGX, KWD). Amounts in different
//    currencies are never summed or submitted together. ─────────────────

export interface CurrencyOption {
  /** Identity of the currency (ISO code from rDash, e.g. "INR"). */
  code: string;
  name: string;
  symbol: string;
}

const codeOf = (r: Pick<AllocationRow, "config">): string | null => {
  const c = r.config.currency?.code;
  return typeof c === "string" && c.trim() !== "" ? c : null;
};

/** One option per currency code found in the rows, sorted by name
 *  ("Indian National Rupee - INR"). Rows without a currency code are not
 *  options (see rowsWithoutCurrency — they are reported, never hidden silently). */
export function listCurrencies(rows: Pick<AllocationRow, "config">[]): CurrencyOption[] {
  const byCode = new Map<string, CurrencyOption>();
  for (const r of rows) {
    const code = codeOf(r);
    if (!code || byCode.has(code)) continue;
    const c = r.config.currency;
    byCode.set(code, { code, name: typeof c.name === "string" && c.name ? c.name : code, symbol: typeof c.symbol === "string" ? c.symbol : "" });
  }
  return Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

/** "<name> - <code>" — rDash's option label. */
export const currencyLabel = (o: CurrencyOption) => `${o.name} - ${o.code}`;

/** Search box: case-insensitive match on name or code. */
export function filterCurrencyOptions(options: CurrencyOption[], query: string): CurrencyOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q));
}

/** Selection after (re)loading rows: keep the current choice if it still
 *  exists; otherwise auto-select only when there is exactly ONE currency.
 *  Several → null (the user must pick — no default, no guess). */
export function resolveSelectedCurrency(options: CurrencyOption[], current: string | null): string | null {
  if (current && options.some((o) => o.code === current)) return current;
  return options.length === 1 ? options[0].code : null;
}

/** Rows of the selected currency only (none selected → none). */
export function rowsForCurrency<T extends Pick<AllocationRow, "config">>(rows: T[], code: string | null): T[] {
  if (!code) return [];
  return rows.filter((r) => codeOf(r) === code);
}

/** Rows whose currency has no code — can't be filtered or summed. */
export function rowsWithoutCurrency(rows: Pick<AllocationRow, "config">[]): number {
  return rows.filter((r) => codeOf(r) === null).length;
}

/** Distinct currency codes of config items (server-side same-currency rule;
 *  a missing code counts as its own value). */
export function distinctCurrencyCodes(items: Pick<AllocationRow["config"], "currency">[]): Set<string> {
  return new Set(items.map((c) => (typeof c.currency?.code === "string" && c.currency.code ? c.currency.code : "∅")));
}
