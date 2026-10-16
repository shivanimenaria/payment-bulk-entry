"use client";

import { Filter } from "lucide-react";
import type { AllocationRow as Row } from "@/types/payments";
import { rdCard } from "@/components/rd/styles";
import { RdStepper } from "@/components/rd/RdStepper";
import { cn } from "@/lib/utils";
import { AllocationRow } from "./AllocationRow";

// Amount columns carry the currency symbol, like rDash's "Payment Done (₹)".
const COLUMNS: { label: string; right?: boolean; center?: boolean; money?: boolean }[] = [
  { label: "S.No", center: true },
  { label: "Request Date" },
  { label: "Request ID" },
  { label: "Project Name" },
  { label: "Request Type" },
  { label: "Due Date" },
  { label: "Requested By" },
  { label: "Status" },
  { label: "Requested Amount", right: true, money: true },
  { label: "Payment Due", right: true, money: true },
  { label: "Payment Done", money: true },
  { label: "Remarks" },
];

/** S.No column width — the footer buttons line up with the next column, like
 *  rDash's create-payment-request-btn (grid 0.5fr 11.5fr). */
export const SNO_WIDTH = 56;

// rDash table box (border rounded-6): stepper bar as the title row, body
// (table / state), footer row like "+ Create Payment Request" (49px, top
// border, white, bottom radius 6).
export function TableBox({
  title,
  action,
  footer,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label="Payment due" className={cn(rdCard, "flex min-w-0 flex-col overflow-hidden")}>
      <RdStepper items={[{ key: "due", label: title, active: true }]} right={action} />
      <div className="min-w-0">{children}</div>
      {footer ? (
        <div
          className="flex h-[49px] items-center gap-2 rounded-b-rd border-t border-rd-border bg-white pr-5"
          style={{ paddingLeft: 20 + SNO_WIDTH + 5 }}
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}

// Header (RDTableHeader: bg-white border-b): 12px semibold black labels; the
// S.No column carries rDash's funnel indicator on the filter line. PBE has no
// column filters, so that line is otherwise empty (same height as rDash's).
// The table scrolls horizontally inside the box so the form and cards stay
// in view.
export function AllocationTable({
  rows,
  rowErrors,
  onAmount,
  onPayInFull,
  onRemark,
  onRemove,
  currencySymbol,
}: {
  /** Single currency symbol of the rows (null = none / mixed). */
  currencySymbol: string | null;
  rows: Row[];
  rowErrors: Record<number, Record<string, string>>;
  onAmount: (index: number, value: string) => void;
  onPayInFull: (index: number) => void;
  onRemark: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1400px] border-collapse">
        <thead>
          <tr className="border-b border-rd-border bg-white">
            {COLUMNS.map((c, i) => (
              <th
                key={c.label}
                scope="col"
                style={i === 0 ? { width: SNO_WIDTH + 20 } : undefined}
                className={cn(
                  "whitespace-nowrap px-[5px] pb-4 pt-[17px] align-top text-[12px] font-semibold text-rd-black",
                  i === 0 && "pl-5",
                  i === COLUMNS.length - 1 && "pr-5",
                  c.right ? "text-right" : c.center ? "text-center" : "text-left",
                )}
              >
                <div className="leading-[15px]">
                  {c.label}
                  {c.money && currencySymbol ? ` (${currencySymbol})` : ""}
                </div>
                <div className="mt-[6px] flex h-[22px] items-center justify-center">
                  {i === 0 ? <Filter aria-hidden="true" className="h-[18px] w-[18px] text-[#c3c6cb]" strokeWidth={1.25} /> : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <AllocationRow
              key={row.config.payment_request_id}
              row={row}
              index={i}
              amountError={rowErrors[i]?.amount}
              onAmount={(v) => onAmount(i, v)}
              onPayInFull={() => onPayInFull(i)}
              onRemark={(v) => onRemark(i, v)}
              onRemove={() => onRemove(i)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// rDash PaymentEntryRowsLoader: rows of p-20 border-b with MUI text skeletons.
export function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading payment requests">
      {Array.from({ length: 10 }).map((_, r) => (
        <div key={r} className="grid grid-cols-[0.5fr_1.5fr_1.75fr_2fr_1.75fr_1.75fr_1.5fr_1.5fr_1.75fr_1.5fr] gap-[10px] border-b border-rd-border p-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={cn("h-[14px] animate-pulse rounded bg-black/[0.11]", i === 0 && "w-5")} />
          ))}
        </div>
      ))}
    </div>
  );
}
