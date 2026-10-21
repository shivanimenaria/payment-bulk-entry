"use client";

import { Clock } from "lucide-react";
import type { AllocationRow as Row } from "@/types/payments";
import { isAmountEditable, rowAmountIssue } from "@/lib/payments/allocation";
import { isAllowedAmountInput } from "@/lib/payments/money";
import { formatRequestType, textOrDash } from "@/lib/format";
import {
  dueDateDisplay,
  formatSerial,
  formatShortDate,
  formatTableAmount,
  requestTypeBadgeClass,
  statusBadge,
} from "@/lib/payments/table-display";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { rdTextLinkSm } from "@/components/rd/styles";

// RFQ list table row (docs/ui-reference/rfq-table/rfq-app/RfqListClient.tsx):
// shadcn TableCell `p-4 align-middle`, TableRow `border-b transition-colors
// hover:bg-gray-50/80` (background only — text colours never change on
// hover), deadline-urgency left accent bar (here: Due Date).
const td = "p-4 align-middle";
// Amount cells: fixed width (table-fixed column); long values (up to 29
// digits) are cut with an ellipsis and shown in full in the title tooltip.
const amountText = "block truncate text-sm font-semibold tabular-nums text-gray-900";

/** RFQ input look (filter-row size) for Payment Done / Remarks. */
const rfqInput =
  "h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-rd-red focus:ring-1 focus:ring-rd-red disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

function Pending() {
  return <span className="text-xs italic text-gray-400">Details pending</span>;
}

export function AllocationRow({
  row,
  index,
  position,
  todayKey,
  currencySymbol,
  readOnly = false,
  amountError,
  onAmount,
  onPayInFull,
  onRemark,
}: {
  row: Row;
  /** Index in the full (currency) list — handlers, errors, aria labels. */
  index: number;
  /** 1-based place among the shown rows → S.No "01" (continues across pages). */
  position: number;
  /** Today's local "YYYY-MM-DD" (Due Date colour / accent). */
  todayKey: string;
  currencySymbol: string | null;
  /** Page 1: no Payment Done / Pay in full / Remarks cells. */
  readOnly?: boolean;
  amountError?: string;
  onAmount: (value: string) => void;
  onPayInFull: () => void;
  onRemark: (value: string) => void;
}) {
  const d = row.details;
  const editable = isAmountEditable(row);
  // Detail columns: pending (no project), failed (details error) or the value.
  const detail = (value: React.ReactNode) =>
    row.detailsUnavailable ? <Pending /> : row.detailsError ? <span className="text-xs text-gray-400">—</span> : value;
  // An amount PBE can't process (too large / invalid) is always shown and
  // locks the row (isAmountEditable).
  const inlineError = rowAmountIssue(row) ?? row.rowError ?? row.detailsError ?? amountError ?? null;
  const due = dueDateDisplay(d?.due_date, todayKey);
  const st = statusBadge(row.config.status);
  const requested = formatTableAmount(row.config.request_amount, currencySymbol);
  const paymentDue = formatTableAmount(row.config.payment_due, currencySymbol);

  return (
    <tr
      className={cn(
        "border-b transition-colors hover:bg-gray-50/80",
        row.rowError ? "bg-rd-row-error" : "bg-white",
        !row.detailsUnavailable && !row.detailsError && due.accent,
      )}
    >
      <td className={cn(td, "pl-5 text-xs font-normal text-gray-400")}>{formatSerial(position)}</td>
      {/* Request ID: single line, semibold gray-900 (plain text, no hover). */}
      <td className={td}>
        {row.detailsUnavailable ? (
          <Pending />
        ) : (
          <p
            title={d?.request_number ?? undefined}
            className="truncate text-sm font-semibold leading-snug text-gray-900"
          >
            {textOrDash(d?.request_number)}
          </p>
        )}
      </td>
      {/* Project Name: normal text like Requested By, max 2 lines + tooltip. */}
      <td className={cn(td, "whitespace-normal")} title={row.projectName ?? undefined}>
        <span className="line-clamp-2 break-words text-sm text-gray-900">
          {textOrDash(row.projectName)}
          {/* TODO(remove-temp-project-id): project resolved via RDASH_TEMP_PROJECT_ID —
              never present it as confirmed. */}
          {row.projectIdSource === "temporary" ? (
            <span className="ml-1 text-xs font-semibold text-rd-pending" title="Project not confirmed by rDash (temporary workaround)">
              (temporary)
            </span>
          ) : null}
        </span>
      </td>
      <td className={td}>{detail(<span className="text-xs text-gray-500">{formatShortDate(d?.requested_at)}</span>)}</td>
      <td className={td}>
        {detail(
          d?.request_type ? (
            <Badge variant="outline" className={cn("whitespace-nowrap px-2 py-0.5 text-xs font-medium", requestTypeBadgeClass(d.request_type))}>
              {formatRequestType(d.request_type)}
            </Badge>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          ),
        )}
      </td>
      <td className={td}>
        {detail(
          <div className="flex items-center gap-1.5" data-due={due.className.includes("red") ? "past" : "ok"}>
            {due.icon ? <Clock className={cn("h-3.5 w-3.5 flex-shrink-0", due.className.includes("red") ? "text-red-600" : "text-gray-500")} /> : null}
            <span className={cn("text-xs", due.className)}>{due.text}</span>
          </div>,
        )}
      </td>
      <td className={cn(td, "whitespace-normal")}>{detail(<span className="text-sm text-gray-700">{textOrDash(d?.requested_by?.name)}</span>)}</td>
      <td className={td}>
        <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap text-xs font-medium", st.className)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
          {st.label}
        </Badge>
      </td>
      <td className={cn(td, "text-right")} title={requested}>
        <span className={amountText}>{requested}</span>
      </td>
      <td className={cn(td, "text-right", readOnly && "pr-5")} title={paymentDue}>
        <span className={amountText}>{paymentDue}</span>
      </td>
      {readOnly ? null : (
        <>
          <td className={cn(td, "align-top")}>
            <div className="flex items-center gap-2">
              <input
                aria-label={`Payment done, row ${index + 1}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                disabled={!editable}
                className={cn(rfqInput, "w-28 text-right tabular-nums", amountError && "border-rd-red ring-1 ring-rd-red")}
                title={row.amount || undefined}
                value={row.amount}
                // Block typing beyond 20 integer digits / 4 decimals (bulk API limit).
                onChange={(e) => {
                  if (isAllowedAmountInput(e.target.value)) onAmount(e.target.value);
                }}
              />
              <button type="button" disabled={!editable} onClick={onPayInFull} className={cn(rdTextLinkSm, "whitespace-nowrap")}>
                Pay in full
              </button>
            </div>
            {inlineError ? <p className="mt-1 whitespace-normal text-[12px] leading-[15px] text-rd-red">{inlineError}</p> : null}
            {row.rowStatus === "created" && !inlineError ? (
              <p className="mt-1 text-[12px] font-semibold leading-[15px] text-rd-approved">Recorded</p>
            ) : null}
          </td>
          <td className={cn(td, "align-top pr-5")}>
            <input
              aria-label={`Remarks, row ${index + 1}`}
              autoComplete="off"
              className={cn(rfqInput, "w-full")}
              value={row.remark}
              onChange={(e) => onRemark(e.target.value)}
            />
          </td>
        </>
      )}
    </tr>
  );
}
