"use client";

import { ExpenseIcon } from "@/components/rd/ExpenseIcon";
import { rdButtonOutline } from "@/components/rd/styles";

// rDash NoPaymentEntry: centred column, gap 20, #d0d5dd; ExpenseIcon 90×90 +
// 24px semibold text.
export function EmptyState({ message = "No payable requests to show" }: { message?: string }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-5 text-rd-disabled">
      <ExpenseIcon size={90} />
      <div className="text-[24px] font-semibold">{message}</div>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 p-5">
      <p className="text-[14px] font-semibold text-rd-red">{message}</p>
      <button type="button" onClick={onRetry} className={rdButtonOutline}>
        Retry
      </button>
    </div>
  );
}
