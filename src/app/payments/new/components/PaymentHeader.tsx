"use client";

import type { PaymentHeader as PaymentHeaderValue } from "@/types/payments";
import type { PaymentMode } from "@/types/rdash";
import { PAYMENT_MODES } from "@/lib/payments/validation";
import { cn } from "@/lib/utils";

const MODE_LABELS: Record<PaymentMode, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
  upi: "UPI",
};

const inputCls =
  "h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-50";

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
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-gray-600">
        {label}
        {required ? <span className="ml-0.5 text-primary">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
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
    <section aria-label="Payment details" className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Amount paid" required htmlFor="amountPaid" error={errors.amountPaid}>
          <input
            id="amountPaid"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className={cn(inputCls, "text-right tabular-nums", errors.amountPaid && "border-red-400")}
            value={value.amountPaid}
            onChange={(e) => onChange("amountPaid", e.target.value)}
          />
        </Field>
        <Field label="Payment date" required htmlFor="paymentDate" error={errors.paymentDate}>
          <input
            id="paymentDate"
            type="date"
            className={cn(inputCls, errors.paymentDate && "border-red-400")}
            value={value.paymentDate}
            onChange={(e) => onChange("paymentDate", e.target.value)}
          />
        </Field>
        <Field label="Payment mode" required htmlFor="paymentMode" error={errors.paymentMode}>
          <select
            id="paymentMode"
            className={cn(inputCls, !value.paymentMode && "text-gray-400", errors.paymentMode && "border-red-400")}
            value={value.paymentMode ?? ""}
            onChange={(e) => onChange("paymentMode", (e.target.value || null) as PaymentMode | null)}
          >
            <option value="" disabled>
              Select mode
            </option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m} className="text-gray-900">
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference / UTR" htmlFor="reference" error={errors.reference}>
          <input
            id="reference"
            autoComplete="off"
            className={inputCls}
            value={value.reference}
            onChange={(e) => onChange("reference", e.target.value)}
          />
        </Field>
        <Field label="Remark" htmlFor="headerRemark" error={errors.remark} className="md:col-span-2">
          <input
            id="headerRemark"
            autoComplete="off"
            placeholder="Copied to every row unless the row is edited"
            className={inputCls}
            value={value.remark}
            onChange={(e) => onChange("remark", e.target.value)}
          />
        </Field>
      </div>
    </section>
  );
}
