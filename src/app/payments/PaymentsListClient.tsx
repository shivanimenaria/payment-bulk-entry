"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { CurrencyFilter } from "@/components/rd/CurrencyFilter";
import { rdTextLink } from "@/components/rd/styles";
import { useFilteredPaging } from "./useFilteredPaging";
import { useSession } from "@/lib/auth-context";
import { canCreatePayment, NEW_PAYMENT_PATH, withCurrency } from "@/lib/payments/payment-form";
import { VendorSummaryCards } from "./components/SummaryCards";
import { AllocationTable, TableBox, TablePagination, TableSkeleton, rfqFooterLink } from "./components/AllocationTable";
import { EmptyState, LoadError } from "./components/EmptyState";
import { usePaymentRequests } from "./usePaymentRequests";

// /payments — page 1, what the Bulk Payment tab opens: currency filter, the
// five rDash Vendor Payments amount cards (server-computed summaries for the
// selected currency), the vendor's payable requests read-only (no Payment
// Done / Pay in full / Remarks), 20 per page, and "+ Create Payment" →
// /payments/new (currency as ?currency=). /payments/new comes back here
// (fresh load) after its result prompt's OK.
export function PaymentsListClient() {
  const router = useRouter();
  const { buildUrl } = useSession();
  const data = usePaymentRequests();
  const { load, rows, visibleRows, selectedOption, selectedCurrency, currencyOptions, needsCurrencyPick, noCurrencyCount } = data;


  // Client-side filters + paging over the currency's rows (display only).
  const view = useFilteredPaging(visibleRows, selectedCurrency, data.loadSeq);
  const { slice } = view;
  const symbol = selectedOption?.symbol || null;
  const canCreate = canCreatePayment({ loaded: load.status === "ready", payableCount: visibleRows.length });


  return (
    <>
      <PageHeader
        actions={
          <CurrencyFilter
            options={currencyOptions}
            selected={selectedOption?.code ?? null}
            onSelect={(code) => data.setPickedCurrency(code)}
            disabled={load.status !== "ready"}
          />
        }
      />
      {/* Fills the remaining height; only the table rows scroll (TableBox). */}
      <main className="flex min-h-0 flex-1 flex-col gap-5 p-5">
        <VendorSummaryCards summary={load.status === "ready" ? data.summary : null} symbol={symbol} />
        <TableBox
          title="Payment due"
          action={
            view.active ? (
              <button type="button" className={rdTextLink} onClick={view.clearFilters}>
                Clear filters
              </button>
            ) : undefined
          }
          footer={
            <>
              {/* rDash "+ Create Payment Request" (RDButton variant="text-red"). */}
              <button type="button" className={rfqFooterLink} disabled={!canCreate} onClick={() => router.push(buildUrl(withCurrency(NEW_PAYMENT_PATH, selectedCurrency)))}>
                + Create Payment
              </button>
              {load.status === "ready" && noCurrencyCount > 0 ? (
                <span className="text-[12px] text-rd-pending">
                  {noCurrencyCount} request{noCurrencyCount === 1 ? " has" : "s have"} no currency from rDash and can&apos;t be shown.
                </span>
              ) : null}
              {load.status === "ready" && visibleRows.length > 0 ? (
                <TablePagination slice={slice} errorPages={[]} onPage={view.goToPage} />
              ) : null}
            </>
          }
        >
          <AllocationTable
            readOnly
            currencySymbol={symbol}
            items={load.status === "ready" ? slice.rows : []}
            filters={view.filters}
            filterOptions={view.options}
            onFilters={view.setFilters}
            todayKey={view.todayKey}
            placeholder={
              load.status === "loading" ? (
                <TableSkeleton />
              ) : load.status === "error" ? (
                <LoadError message={load.message} onRetry={() => void data.loadRows()} />
              ) : rows.length === 0 ? (
                <EmptyState />
              ) : needsCurrencyPick ? (
                <EmptyState message="Select a currency to see payment requests" />
              ) : view.shown.length === 0 && visibleRows.length > 0 ? (
                <EmptyState message="No payment requests match your filters" />
              ) : null
            }
            placeholderAlign={load.status === "loading" ? "top" : "center"}
          />
        </TableBox>
      </main>

    </>
  );
}
