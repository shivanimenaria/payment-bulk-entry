"use client";

import type { AllocationRow as Row } from "@/types/payments";
import { isAmountEditable, rowAmountIssue } from "@/lib/payments/allocation";
import { isAllowedAmountInput } from "@/lib/payments/money";
import { DASH, formatDate, formatRdashAmount, formatRequestType, textOrDash } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rdInputCls, rdStatusClass, rdTextLinkSm } from "@/components/rd/styles";

// rDash row: font-size-14, p-20 (20px vertical; 10px column gap), border-b
// #c7c8c9, black text; amounts right-aligned.
const cell = "whitespace-nowrap px-[5px] py-5 align-top text-[14px] leading-[22px] text-rd-black";
// Amount cells: fixed width; long values (up to 29 digits) are cut with an
// ellipsis and shown in full in the title tooltip.
const num = "text-right tabular-nums";
const amountCell = "w-[150px] min-w-[150px] max-w-[150px] truncate";

function Pending() {
  return <span className="italic text-rd-placeholder">Details pending</span>;
}

/** rDash toTitleCase: "partially_paid" → "Partially Paid". */
function titleCase(value: string | null | undefined): string {
  if (!value) return DASH;
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
    row.detailsUnavailable ? <Pending /> : row.detailsError ? <span className="text-rd-placeholder">{DASH}</span> : value;
  // An amount PBE can't process (too large / invalid) is always shown and
  // locks the row (isAmountEditable).
  const inlineError = rowAmountIssue(row) ?? row.rowError ?? row.detailsError ?? amountError ?? null;

  return (
    <tr className={cn("border-b border-rd-border last:border-0", row.rowError ? "bg-rd-row-error" : "bg-white")}>
      <td className={cn(cell, "pl-5 text-center")}>{index + 1}.</td>
      <td className={cell}>{detail(formatDate(d?.requested_at))}</td>
      <td className={cell}>{detail(textOrDash(d?.request_number))}</td>
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
                <span className="text-[12px] font-semibold text-rd-pending" title="Project not confirmed by rDash (temporary workaround)">
                  (temporary)
                </span>
              </>
            ) : null}
          </span>
        )}
      </td>
      <td className={cell}>{detail(formatRequestType(d?.request_type))}</td>
      <td className={cell}>{detail(formatDate(d?.due_date))}</td>
      <td className={cell}>{detail(textOrDash(d?.requested_by?.name))}</td>
      <td className={cn(cell, rdStatusClass(row.config.status))}>{titleCase(row.config.status)}</td>
      <td className={cn(cell, num, amountCell)} title={formatRdashAmount(row.config.request_amount)}>
        {formatRdashAmount(row.config.request_amount)}
      </td>
      <td className={cn(cell, num, amountCell)} title={formatRdashAmount(row.config.payment_due)}>
        {formatRdashAmount(row.config.payment_due)}
      </td>
      <td className={cn(cell, "min-w-[190px]")}>
        <div className="flex items-center gap-2">
          <input
            aria-label={`Payment done, row ${index + 1}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            disabled={!editable}
            className={rdInputCls(!!amountError, "w-28 text-right tabular-nums")}
            title={row.amount || undefined}
            value={row.amount}
            // Block typing beyond 20 integer digits / 4 decimals (bulk API limit).
            onChange={(e) => {
              if (isAllowedAmountInput(e.target.value)) onAmount(e.target.value);
            }}
          />
          <button type="button" disabled={!editable} onClick={onPayInFull} className={rdTextLinkSm}>
            Pay in full
          </button>
        </div>
        {inlineError ? <p className="mt-1 max-w-[220px] whitespace-normal text-[12px] leading-[15px] text-rd-red">{inlineError}</p> : null}
        {row.rowStatus === "created" && !inlineError ? (
          <p className="mt-1 text-[12px] font-semibold leading-[15px] text-rd-approved">Recorded</p>
        ) : null}
        {row.rowError ? (
          <button
            type="button"
            onClick={onRemove}
            className="mt-1 text-[12px] font-semibold text-rd-text underline-offset-2 hover:underline"
            title="Don't retry this request — clears its amount and unlocks the row"
          >
            Remove
          </button>
        ) : null}
      </td>
      <td className={cn(cell, "min-w-[200px] pr-5")}>
        <input
          aria-label={`Remarks, row ${index + 1}`}
          autoComplete="off"
          className={rdInputCls(false, "w-48")}
          value={row.remark}
          onChange={(e) => onRemark(e.target.value)}
        />
      </td>
    </tr>
  );
}
