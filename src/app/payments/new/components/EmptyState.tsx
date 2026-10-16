"use client";

import { Inbox } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-14 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <Inbox className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-gray-900">No payable requests for this vendor</p>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm text-red-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="h-8 shrink-0 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-100"
      >
        Retry
      </button>
    </div>
  );
}
