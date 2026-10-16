"use client";

import { rdCard } from "@/components/rd/styles";

// Live list of validation problems (validateAllocation().summary).
export function ValidationList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className={`${rdCard} px-4 py-3`}>
      <p className="text-[14px] font-semibold text-rd-pending">Fix before submitting</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-rd-black">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
