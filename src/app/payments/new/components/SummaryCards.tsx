"use client";

import { ListChecks, ReceiptText, Scale, Wallet, type LucideIcon } from "lucide-react";
import type { Totals } from "@/lib/payments/totals";
import type { Units } from "@/lib/payments/money";
import { DASH, formatCardUnits } from "@/lib/format";
import { rdCard, rdCountLabel } from "@/components/rd/styles";
import { cn } from "@/lib/utils";


// rDash PaymentRequestAmountCard: bg-white p-15 border rounded-6 gap-10,
// min-height 84, text #344054; title row = 14px black icon + 16px semibold
// title + grey contained count label; value = 20px semibold "₹ 2,00,000".
function Card({
  label,
  Icon,
  value,
  count,
  danger,
  note,
}: {
  label: string;
  Icon: LucideIcon;
  value: string;
  count?: number | null;
  danger?: boolean;
  note?: string | null;
}) {
  return (
    <div className={cn(rdCard, "flex min-h-[84px] min-w-0 flex-1 flex-col gap-[10px] p-[15px] text-rd-text")}>
      <div className="flex items-center gap-[5px] whitespace-nowrap">
        <Icon className="h-[14px] w-[14px] shrink-0 text-black" strokeWidth={2} />
        <p className="truncate text-[16px] font-semibold leading-[1.2]">{label}</p>
        {count !== undefined ? <span className={rdCountLabel}>{count === null ? DASH : count}</span> : null}
      </div>
      {/* Long amounts (up to 29 digits) never break the card: ellipsis + full value on hover. */}
      <p title={value} className={cn("truncate text-[20px] font-semibold leading-[1.2] tabular-nums", danger && "text-rd-red")}>{value}</p>
      {note ? <p className="text-[12px] text-rd-muted">{note}</p> : null}
    </div>
  );
}

// Summary row (rDash amount cards, gap 16). All numbers come from
// computeTotals (exact BigInt units). Until the rows have loaded, row-based
// figures show "—" (never a ₹ 0 that wasn't loaded).
export function SummaryCards({
  totals,
  loaded,
  rowCount,
  currency,
}: {
  totals: Totals;
  loaded: boolean;
  /** Payable rows shown in the table. */
  rowCount: number;
  /** From the rows' rDash currency objects (lib/payments/currency.ts). */
  currency: { symbol: string | null; mixed: boolean };
}) {
  // Mixed currencies can't be summed — row totals show "—" (never a guess).
  const money = (units: Units | null) => formatCardUnits(units, currency.symbol);
  const rowMoney = (units: Units | null) => (currency.mixed ? DASH : money(units));
  const unprocessable = loaded && totals.unprocessableCount > 0
    ? `Excludes ${totals.unprocessableCount} request${totals.unprocessableCount === 1 ? "" : "s"} that can't be processed`
    : null;
  const excessNonZero = loaded && totals.excessUnits !== null && totals.excessUnits !== BigInt(0);
  return (
    <section aria-label="Summary" className="flex flex-wrap gap-4">
      <Card
        label="Total Due"
        Icon={ReceiptText}
        value={rowMoney(loaded ? totals.totalDueUnits : null)}
        count={loaded ? rowCount : null}
        note={currency.mixed ? "Mixed currencies" : unprocessable}
      />
      <Card label="Amount Paid" Icon={Wallet} value={money(totals.amountPaidUnits)} />
      <Card
        label="Allocated"
        Icon={ListChecks}
        value={rowMoney(loaded ? totals.allocatedUnits : null)}
        count={loaded ? totals.selectedCount : null}
      />
      <Card label="Excess" Icon={Scale} value={rowMoney(loaded ? totals.excessUnits : null)} danger={excessNonZero} />
    </section>
  );
}
