"use client";

import { Clock, MessageSquareText } from "lucide-react";
import type { PaymentHeader as PaymentHeaderValue } from "@/types/payments";
import type { PaymentMode } from "@/types/rdash";
import type { Totals } from "@/lib/payments/totals";
import { PAYMENT_MODES } from "@/lib/payments/validation";
import { PAYMENT_MODE_LABELS, paidAndExcess } from "@/lib/payments/payment-form";
import { isAllowedAmountInput } from "@/lib/payments/money";
import { DASH, formatCardUnits } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rdTextLinkSm } from "@/components/rd/styles";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// RFQ form-box classes (docs/ui-reference/rfq-create/CreateRfqClient.tsx).
const label = "mb-1.5 block text-xs text-gray-500";
const labelWithIcon = "mb-1.5 flex items-center gap-1.5 text-xs text-gray-500";
const control = (invalid: boolean, extra?: string) =>
  cn("h-9 text-sm", invalid ? "border-red-500 focus-visible:ring-red-200" : "border-gray-200", extra);
/** RFQ read-only field (revise-mode "Draft Order"). */
const readOnlyField =
  "flex h-9 min-w-0 cursor-not-allowed items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600";

const Req = () => <span className="text-red-500">*</span>;

/** Red 11px error under the field, placed in the grid gap (absolute) so it
 *  never changes the card height — the table below never moves. */
function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span id={`${id}-error`} title={message} className="absolute left-0 right-0 top-full mt-0.5 truncate text-[11px] leading-[14px] text-red-600">
      {message}
    </span>
  ) : null;
}

// Payment form card on /payments/new, laid out like the RFQ "Create RFQ" form
// box: white `rounded-xl border-gray-200 shadow-sm` card, `px-6 py-5`, 5-col
// grid (`gap-x-5 gap-y-4`), grey 12px labels with a red "*", white bordered
// h-9 inputs, red 11px errors under the field, and a status line under a
// divider (RFQ "Order Status: Not Sent" → "Total Due: ₹ X (n requests)").
//   Row 1: Amount Paid* · Payment Date* · Payment Mode* · Reference / UTR (2 cols)
//   Row 2: Remark (3 cols, like Shipping Address) · Allocated · Excess
// Allocated / Excess are read-only and live (exact units, computeTotals);
// Excess is red when ≠ 0 and "—" until Amount Paid is valid (paidAndExcess).
// Errors are inline and appear only after Submit: under each field, and one
// red line for whole-submission errors next to Total Due (no message panel).
// "Auto allocate" (next to Allocated) fills Payment Done top to bottom
// (lib/payments/allocation.ts autoAllocate); disabled until Amount Paid > 0.
// Long amounts: ellipsis + title tooltip.
export function CreatePaymentForm({
  value,
  errors,
  onChange,
  totals,
  loaded,
  payableCount,
  symbol,
  canAutoAllocate,
  onAutoAllocate,
  formMessage,
  footerExtra,
}: {
  value: PaymentHeaderValue;
  /** Field errors (visibleFieldErrors: touched fields, or all after Submit). */
  errors: Partial<Record<keyof PaymentHeaderValue, string>>;
  onChange: <K extends keyof PaymentHeaderValue>(field: K, v: PaymentHeaderValue[K]) => void;
  totals: Totals;
  /** Rows loaded and a currency selected (else figures show "—"). */
  loaded: boolean;
  payableCount: number;
  symbol: string | null;
  /** Amount Paid is a valid amount > 0 and rows are loaded. */
  canAutoAllocate: boolean;
  onAutoAllocate: () => void;
  /** Whole-submission / submit error (formLevelMessage): one small red line
   *  next to Total Due. */
  formMessage?: string | null;
  /** Other one-line notes for the footer (refresh error + Retry, no-currency note). */
  footerExtra?: React.ReactNode;
}) {
  const { excessUnits } = paidAndExcess(totals);
  const allocated = loaded ? formatCardUnits(totals.allocatedUnits, symbol) : DASH;
  const excess = loaded && excessUnits !== null ? formatCardUnits(excessUnits, symbol) : DASH;
  const excessNonZero = loaded && excessUnits !== null && excessUnits !== BigInt(0);
  const totalDue = loaded ? formatCardUnits(totals.totalDueUnits, symbol) : DASH;
  return (
    <section aria-label="Payment details" className="shrink-0 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="px-6 py-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {/* Row 1 */}
          <div className="relative">
            <Label htmlFor="amountPaid" className={label}>
              Amount Paid <Req />
            </Label>
            <Input
              id="amountPaid"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Enter amount"
              aria-invalid={!!errors.amountPaid}
              className={control(!!errors.amountPaid, "tabular-nums")}
              value={value.amountPaid}
              // Block typing beyond 20 integer digits / 4 decimals (bulk API limit).
              onChange={(e) => {
                if (isAllowedAmountInput(e.target.value)) onChange("amountPaid", e.target.value);
              }}
            />
            <FieldError id="amountPaid" message={errors.amountPaid} />
          </div>
          <div className="relative">
            <Label htmlFor="paymentDate" className={labelWithIcon}>
              <Clock className="h-3 w-3" /> Payment Date <Req />
            </Label>
            <Input
              id="paymentDate"
              type="date"
              aria-invalid={!!errors.paymentDate}
              value={value.paymentDate}
              onChange={(e) => onChange("paymentDate", e.target.value)}
              // RFQ Deadline Date: calendar-only editing (typing / paste
              // blocked), the native picker opens on click; value YYYY-MM-DD.
              onKeyDown={(e) => {
                if (e.key !== "Tab") e.preventDefault();
              }}
              onPaste={(e) => e.preventDefault()}
              onClick={(e) => {
                const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                try {
                  if (typeof el.showPicker === "function") el.showPicker();
                } catch {
                  // Not allowed (e.g. no user gesture) — the native control still works.
                }
              }}
              className={control(!!errors.paymentDate, "cursor-pointer")}
            />
            <FieldError id="paymentDate" message={errors.paymentDate} />
          </div>
          <div className="relative">
            <Label htmlFor="paymentMode" className={label}>
              Payment Mode <Req />
            </Label>
            <Select
              value={value.paymentMode ?? undefined}
              onValueChange={(v) => onChange("paymentMode", v as PaymentMode)}
            >
              <SelectTrigger id="paymentMode" aria-invalid={!!errors.paymentMode} className={control(!!errors.paymentMode)}>
                <SelectValue placeholder="Select payment mode" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="paymentMode" message={errors.paymentMode} />
          </div>
          <div className="relative col-span-2">
            <Label htmlFor="reference" className={label}>
              Reference / UTR
            </Label>
            <Input
              id="reference"
              autoComplete="off"
              placeholder="Enter reference / UTR"
              aria-invalid={!!errors.reference}
              className={control(!!errors.reference)}
              value={value.reference}
              onChange={(e) => onChange("reference", e.target.value)}
            />
            <FieldError id="reference" message={errors.reference} />
          </div>

          {/* Row 2 */}
          <div className="relative col-span-2 lg:col-span-3">
            <Label htmlFor="headerRemark" className={labelWithIcon}>
              <MessageSquareText className="h-3 w-3" /> Remark
            </Label>
            <Input
              id="headerRemark"
              autoComplete="off"
              placeholder="Copied to every request unless it has its own"
              aria-invalid={!!errors.remark}
              className={control(!!errors.remark)}
              value={value.remark}
              onChange={(e) => onChange("remark", e.target.value)}
            />
            <FieldError id="headerRemark" message={errors.remark} />
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500">Allocated</span>
              {/* Like "Pay in full"; the wrapper carries the tooltip because a
                  disabled button gets no hover events in some browsers. */}
              <span title={canAutoAllocate ? undefined : "Enter Amount Paid first"}>
                <button
                  type="button"
                  data-testid="auto-allocate"
                  disabled={!canAutoAllocate}
                  onClick={onAutoAllocate}
                  className={cn(rdTextLinkSm, "whitespace-nowrap")}
                >
                  Auto allocate
                </button>
              </span>
            </div>
            <div data-testid="allocated-field" className={readOnlyField} title={allocated} aria-readonly="true">
              <span className="truncate font-semibold text-gray-900 tabular-nums">{allocated}</span>
              <span className="shrink-0 text-xs text-gray-400">({loaded ? totals.selectedCount : DASH} selected)</span>
            </div>
          </div>
          <div className="min-w-0">
            <span className={label}>Excess</span>
            <div data-testid="excess-field" className={readOnlyField} title={excess} aria-readonly="true">
              <span className={cn("truncate font-semibold tabular-nums", excessNonZero ? "text-red-600" : "text-gray-900")}>{excess}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar (RFQ "Order Status: Not Sent"). */}
      <div data-testid="form-footer" className="flex min-w-0 items-center gap-6 border-t border-gray-100 px-6 py-2.5 text-sm">
        <span data-testid="total-due-line" className="min-w-0 truncate text-gray-500" title={`Total Due: ${totalDue}`}>
          Total Due: <span className="font-bold text-gray-900 tabular-nums">{totalDue}</span>{" "}
          <span className="text-gray-400">
            ({loaded ? payableCount : DASH} payable request{payableCount === 1 ? "" : "s"})
          </span>
        </span>
        {loaded && totals.unprocessableCount > 0 ? (
          <span className="shrink-0 text-xs text-gray-400">
            Excludes {totals.unprocessableCount} request{totals.unprocessableCount === 1 ? "" : "s"} that can&apos;t be processed
          </span>
        ) : null}
        {footerExtra}
        {formMessage ? (
          <span role="alert" data-testid="form-error" className="ml-auto min-w-0 truncate text-xs text-red-600" title={formMessage}>
            {formMessage}
          </span>
        ) : null}
      </div>
    </section>
  );
}
