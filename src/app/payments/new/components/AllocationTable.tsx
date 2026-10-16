"use client";

import type { AllocationRow as Row } from "@/types/payments";
import { AllocationRow } from "./AllocationRow";

const COLUMNS: { label: string; right?: boolean }[] = [
  { label: "S.No" },
  { label: "Request Date" },
  { label: "Request ID" },
  { label: "Project Name" },
  { label: "Request Type" },
  { label: "Due Date" },
  { label: "Requested By" },
  { label: "Status" },
  { label: "Requested Amount", right: true },
  { label: "Payment Due", right: true },
  { label: "Payment Done" },
  { label: "Remarks" },
];

// Wide table: scrolls horizontally inside its own container so the header
// form and summary cards stay in view.
export function AllocationTable({
  rows,
  rowErrors,
  onAmount,
  onPayInFull,
  onRemark,
}: {
  rows: Row[];
  rowErrors: Record<number, Record<string, string>>;
  onAmount: (index: number, value: string) => void;
  onPayInFull: (index: number) => void;
  onRemark: (index: number, value: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full min-w-[1400px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {COLUMNS.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 text-xs font-semibold text-gray-600 ${c.right ? "text-right" : "text-left"}`}
              >
                {c.label}
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
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading payment requests" className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex gap-4 border-b border-gray-200 bg-gray-50 px-3 py-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-3 w-24 animate-pulse rounded bg-gray-200" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-gray-100 px-3 py-3 last:border-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-3 w-24 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ))}
    </div>
  );
}
