import { AppShell } from "@/components/shell/AppShell";

// App frame for /payments and /payments/new (not for /embedded/bootstrap).
export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
