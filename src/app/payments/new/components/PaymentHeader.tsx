"use client";

import type { PaymentHeader as PaymentHeaderValue } from "@/types/payments";
import type { PaymentMode } from "@/types/rdash";
import { PAYMENT_MODES } from "@/lib/payments/validation";
import { cn } from "@/lib/utils";
import { isAllowedAmountInput } from "@/lib/payments/money";
import { rdCard, rdInputCls, rdLabel } from "@/components/rd/styles";
import { RdDateInput, RdSelect } from "@/components/rd/FilterInputs";

const MODE_LABELS: Record<PaymentMode, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
  upi: "UPI",
};


function Field({
  label,
  required,
  error,
  htmlFor,
  className,
  children,
}: {
  className?: string;
  label: string;
  required?: boolean;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-[6px]", className)}>
      <label htmlFor={htmlFor} className={rdLabel}>
        {label}
        {required ? <span className="input-label-required ml-0.5 text-rd-red">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-[11px] text-rd-red">{error}</p> : null}
    </div>
  );
}

// Header form. No vendor field — the vendor is the session vendor.
export function PaymentHeader({
  value,
  errors,
  onChange,
}: {
  value: PaymentHeaderValue;
  /** Field-keyed errors from validateAllocation (shown once the form is dirty). */
  errors: Record<string, string>;
  onChange: <K extends keyof PaymentHeaderValue>(field: K, v: PaymentHeaderValue[K]) => void;
}) {
  return (
    <section aria-label="Payment details" className={cn(rdCard, "px-5 pb-4 pt-[17px]")}>
      <div className="grid grid-cols-1 gap-x-[10px] gap-y-[14px] md:grid-cols-3">
        <Field label="Amount paid" required htmlFor="amountPaid" error={errors.amountPaid}>
          <input
            id="amountPaid"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className={rdInputCls(!!errors.amountPaid, "text-right tabular-nums")}
            value={value.amountPaid}
            // Block typing beyond 20 integer digits / 4 decimals (bulk API limit).
            onChange={(e) => {
              if (isAllowedAmountInput(e.target.value)) onChange("amountPaid", e.target.value);
            }}
          />
        </Field>
        <Field label="Payment date" required htmlFor="paymentDate" error={errors.paymentDate}>
          <RdDateInput
            id="paymentDate"
            invalid={!!errors.paymentDate}
            value={value.paymentDate}
            onChange={(e) => onChange("paymentDate", e.target.value)}
          />
        </Field>
        <Field label="Payment mode" required htmlFor="paymentMode" error={errors.paymentMode}>
          <RdSelect
            id="paymentMode"
            invalid={!!errors.paymentMode}
            placeholderShown={!value.paymentMode}
            value={value.paymentMode ?? ""}
            onChange={(e) => onChange("paymentMode", (e.target.value || null) as PaymentMode | null)}
          >
            <option value="" disabled>
              Select
            </option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m} className="text-rd-black">
                {MODE_LABELS[m]}
              </option>
            ))}
          </RdSelect>
        </Field>
        <Field label="Reference / UTR" htmlFor="reference" error={errors.reference}>
          <input
            id="reference"
            autoComplete="off"
            className={rdInputCls(false)}
            value={value.reference}
            onChange={(e) => onChange("reference", e.target.value)}
          />
        </Field>
        <Field label="Remark" htmlFor="headerRemark" error={errors.remark} className="md:col-span-2">
          <input
            id="headerRemark"
            autoComplete="off"
            placeholder="Copied to every row unless the row is edited"
            className={rdInputCls(false)}
            value={value.remark}
            onChange={(e) => onChange("remark", e.target.value)}
          />
        </Field>
      </div>
    </section>
  );
}
