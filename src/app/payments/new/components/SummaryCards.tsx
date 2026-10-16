"use client";

import type { Totals } from "@/lib/payments/totals";
import { fromPaise } from "@/lib/payments/money";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

const money = (paise: number | null) => formatINR(paise === null ? null : fromPaise(paise));

function Card({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        tone === "warn" ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white",
      )}
    >
      <p className={cn("text-xs font-medium", tone === "warn" ? "text-amber-800" : "text-gray-500")}>{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "warn" ? "text-amber-900" : "text-gray-900")}>
        {value}
      </p>
    </div>
  );
}

// Total due · Amount paid · Allocated · Excess (highlighted when ≠ 0).
// All numbers come from computeTotals (integer paise). Until the rows have
// loaded, row-based figures show "—" (never a ₹0.00 that wasn't loaded).
export function SummaryCards({ totals, loaded }: { totals: Totals; loaded: boolean }) {
  const excessNonZero = loaded && totals.excessPaise !== null && totals.excessPaise !== 0;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card label="Total due" value={money(loaded ? totals.totalDuePaise : null)} />
      <Card label="Amount paid" value={money(totals.amountPaidPaise)} />
      <Card label="Allocated" value={money(loaded ? totals.allocatedPaise : null)} />
      <Card label="Excess" value={money(loaded ? totals.excessPaise : null)} tone={excessNonZero ? "warn" : undefined} />
    </section>
  );
}
