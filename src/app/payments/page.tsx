"use client";

import Link from "next/link";
import { History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/PageHeader";
import { useSession } from "@/lib/auth-context";

// Payments list. TODO: rDash has no API to list past payment entries yet
// (CLAUDE.md Open Items → "Payments list page"). Until it does, this page
// shows an empty state — never placeholder or fake rows.
export default function PaymentsPage() {
  const { buildUrl } = useSession();

  return (
    <>
      <PageHeader
        title="Bulk payment entry"
        actions={
          <Button asChild size="sm" className="h-8 gap-1.5 px-3">
            <Link href={buildUrl("/payments/new")}>
              <Plus className="h-4 w-4" />
              New Payment
            </Link>
          </Button>
        }
      />
      <main className="flex-1 p-6">
        <section className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <History className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-gray-900">Payment history will appear here</p>
          <p className="mt-1 max-w-sm text-xs text-gray-500">
            Record a payment for this vendor with <span className="font-medium text-gray-700">New Payment</span>.
          </p>
        </section>
      </main>
    </>
  );
}
