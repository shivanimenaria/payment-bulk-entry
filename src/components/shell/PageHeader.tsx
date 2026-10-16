"use client";

import { useSession } from "@/lib/auth-context";

// Page title bar. Shows the MOCK DATA badge whenever /api/auth/me reports
// dataSource=mock, and a session error banner if /api/auth/me failed (no
// silent fallback to an anonymous page).
export function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const { dataSource, error } = useSession();
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-4 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {dataSource === "mock" && (
            <span
              className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800"
              title="RDASH_DATA_SOURCE=mock — data is not from rDash"
            >
              Mock data
            </span>
          )}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {error ? (
        <div role="alert" className="border-t border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800">
          Your session could not be verified. Reopen Bulk Payment from the vendor&apos;s Vendor Payments page in rDash.
        </div>
      ) : null}
    </header>
  );
}
