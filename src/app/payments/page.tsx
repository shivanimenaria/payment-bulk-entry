import { PaymentsListClient } from "./PaymentsListClient";

// Page 1 — what the Bulk Payment tab opens: the vendor's payable requests
// (read-only, Total Due) and "+ Create Payment" → /payments/new.
export default function PaymentsPage() {
  return <PaymentsListClient />;
}
