"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { ExpenseIcon } from "@/components/rd/ExpenseIcon";
import { rdButtonPrimary, rdCard } from "@/components/rd/styles";
import { useSession } from "@/lib/auth-context";

// Payments list. TODO: rDash has no API to list past payment entries yet
// (CLAUDE.md Open Items → "Payments list page"). Until it does, this page
// shows an empty state — never placeholder or fake rows.
export default function PaymentsPage() {
  const { buildUrl } = useSession();

  return (
    <>
      <PageHeader
        actions={
          <Link href={buildUrl("/payments/new")} className={rdButtonPrimary}>
            + New Payment
          </Link>
        }
      />
      <main className="flex-1 p-5">
        <section className={`${rdCard} flex min-h-[420px] flex-col items-center justify-center gap-5 text-center text-rd-disabled`}>
          <ExpenseIcon size={90} />
          <p className="text-[24px] font-semibold">Payment history will appear here</p>
          <p className="text-[14px] text-rd-muted">
            Record a payment for this vendor with <span className="font-semibold text-rd-text">New Payment</span>.
          </p>
        </section>
      </main>
    </>
  );
}
