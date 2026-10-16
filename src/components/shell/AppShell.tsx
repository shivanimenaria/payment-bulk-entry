// App frame: white content area only. No sidebar — PBE runs inside rDash's
// Vendor Payments sub-tab, which already shows rDash's own navigation.
export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen min-w-0 flex-col bg-white font-gilroy text-gray-900">{children}</div>;
}
