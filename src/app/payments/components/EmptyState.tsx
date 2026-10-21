"use client";

import { ExpenseIcon } from "@/components/rd/ExpenseIcon";
import { rdButtonOutline } from "@/components/rd/styles";

// rDash NoPaymentEntry: centred column, gap 20, #d0d5dd; ExpenseIcon 90×90 +
// 24px semibold text. Centred in the table's scroll area by AllocationTable.
export function EmptyState({ message = "No payable requests to show" }: { message?: string }) {
  return (
    <div data-testid="empty-state" className="flex flex-col items-center justify-center gap-5 p-5 text-rd-disabled">
      <ExpenseIcon size={90} />
      <div className="text-[24px] font-semibold">{message}</div>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-center gap-4 p-5">
      <p className="text-[14px] font-semibold text-rd-red">{message}</p>
      <button type="button" onClick={onRetry} className={rdButtonOutline}>
        Retry
      </button>
    </div>
  );
}
