"use client";

import type { AllocationRow as Row } from "@/types/payments";
import { isAmountEditable } from "@/lib/payments/allocation";
import { DASH, formatAmount, formatDate, formatStatus, textOrDash } from "@/lib/format";
import { cn } from "@/lib/utils";

const cell = "whitespace-nowrap px-3 py-2 align-top";
const num = "text-right tabular-nums";

function Pending() {
  return <span className="italic text-gray-400">Details pending</span>;
}

export function AllocationRow({
  row,
  index,
  amountError,
  onAmount,
  onPayInFull,
  onRemark,
  onRemove,
}: {
  row: Row;
  index: number;
  amountError?: string;
  onAmount: (value: string) => void;
  onPayInFull: () => void;
  onRemark: (value: string) => void;
  /** Remove a failed (rowError) row from the pending payment. */
  onRemove: () => void;
}) {
  const d = row.details;
  const editable = isAmountEditable(row);
  // Detail columns: pending (no project), failed (details error) or the value.
  const detail = (value: React.ReactNode) =>
    row.detailsUnavailable ? <Pending /> : row.detailsError ? <span className="text-gray-400">{DASH}</span> : value;
  const inlineError = row.rowError ?? row.detailsError ?? amountError ?? null;

  return (
    <tr className={cn("border-b border-gray-100 last:border-0", row.rowError ? "bg-red-50/60" : "hover:bg-gray-50/60")}>
      <td className={cn(cell, "text-gray-500")}>{index + 1}</td>
      <td className={cell}>{detail(formatDate(d?.requested_at))}</td>
      <td className={cn(cell, "font-medium")}>{detail(textOrDash(d?.request_number))}</td>
      <td className={cell}>
        {row.detailsUnavailable ? (
          <Pending />
        ) : (
          <span>
            {textOrDash(row.projectName)}
            {/* TODO(remove-temp-project-id): project resolved via RDASH_TEMP_PROJECT_ID —
                never present it as confirmed. */}
            {row.projectIdSource === "temporary" ? (
              <>
                {" "}
                <span className="text-[11px] font-medium text-amber-700" title="Project not confirmed by rDash (temporary workaround)">
                  (temporary)
                </span>
              </>
            ) : null}
          </span>
        )}
      </td>
      <td className={cell}>{detail(textOrDash(d?.request_type))}</td>
      <td className={cell}>{detail(formatDate(d?.due_date))}</td>
      <td className={cell}>{detail(textOrDash(d?.requested_by))}</td>
      <td className={cell}>
        <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700">
          {formatStatus(row.config.status)}
        </span>
      </td>
      <td className={cn(cell, num)}>{formatAmount(row.config.request_amount)}</td>
      <td className={cn(cell, num, "font-medium")}>{formatAmount(row.config.payment_due)}</td>
      <td className={cn(cell, "min-w-[180px]")}>
        <div className="flex items-center gap-2">
          <input
            aria-label={`Payment done, row ${index + 1}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            disabled={!editable}
            className={cn(
              "h-8 w-28 rounded-md border border-gray-300 bg-white px-2 text-right text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500",
              amountError && "border-red-400",
            )}
            value={row.amount}
            onChange={(e) => onAmount(e.target.value)}
          />
          <button
            type="button"
            disabled={!editable}
            onClick={onPayInFull}
            className="text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
          >
            Pay in full
          </button>
        </div>
        {inlineError ? <p className="mt-1 max-w-[220px] whitespace-normal text-[11px] text-red-600">{inlineError}</p> : null}
        {row.rowError ? (
          <button
            type="button"
            onClick={onRemove}
            className="mt-1 text-[11px] font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
            title="Don't retry this request — clears its amount and unlocks the row"
          >
            Remove
          </button>
        ) : null}
        {row.rowStatus === "created" && !inlineError ? (
          <p className="mt-1 text-[11px] font-medium text-green-700">Recorded</p>
        ) : null}
      </td>
      <td className={cn(cell, "min-w-[200px]")}>
        <input
          aria-label={`Remarks, row ${index + 1}`}
          autoComplete="off"
          className="h-8 w-48 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={row.remark}
          onChange={(e) => onRemark(e.target.value)}
        />
      </td>
    </tr>
  );
}
