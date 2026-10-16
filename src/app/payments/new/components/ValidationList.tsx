"use client";

// Live list of validation problems (validateAllocation().summary).
export function ValidationList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-xs font-semibold text-amber-900">Fix before submitting</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-900">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
