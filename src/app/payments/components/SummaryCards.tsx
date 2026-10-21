"use client";

import { BadgeCheck, ClipboardList, Hourglass, ReceiptText, WalletCards, type LucideIcon } from "lucide-react";
import { rdashUnits } from "@/lib/payments/money";
import { SUMMARY_CARDS, type SummaryCardKey, type VendorPaymentSummary } from "@/lib/payments/summary";
import { DASH, formatCardUnits } from "@/lib/format";
import { rdCard, rdCountLabel } from "@/components/rd/styles";
import { cn } from "@/lib/utils";


// rDash PaymentRequestAmountCard: bg-white p-15 border rounded-6 gap-10,
// min-height 84, text #344054; title row = 14px black icon + 16px semibold
// title + grey contained count label; value = 20px semibold "₹ 2,00,000".
// Shared by both pages so the cards are the same size everywhere.
export function AmountCard({
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

// rDash VendorPaymentRequestAmountCards icons (OrderMainIcon / BillIcon /
// PaymentDoneIcon are rDash assets; closest lucide equivalents here).
const VENDOR_CARD_ICONS: Record<SummaryCardKey, LucideIcon> = {
  paymentRequested: ClipboardList,
  paymentApproved: BadgeCheck,
  pendingApproval: Hourglass,
  paymentDue: WalletCards,
  paymentsDone: ReceiptText,
};

// /payments cards — five rDash Vendor Payments amount cards in one row (gap
// 15): Payment Requested, Payment Approved, Pending Approval, Payment Due,
// Payments Done. Figures come from the route's `summaries` for the selected
// currency (lib/payments/summary.ts — the definitions live there). "—" until
// loaded / no currency selected.
export function VendorSummaryCards({
  summary,
  symbol,
}: {
  summary: VendorPaymentSummary | null;
  symbol: string | null;
}) {
  return (
    <section aria-label="Summary" className="flex shrink-0 gap-[15px]">
      {SUMMARY_CARDS.map(({ key, title }) => (
        <AmountCard
          key={key}
          label={title}
          Icon={VENDOR_CARD_ICONS[key]}
          count={summary ? summary[key].count : null}
          value={summary ? formatCardUnits(rdashUnits(summary[key].total), symbol) : DASH}
        />
      ))}
    </section>
  );
}
