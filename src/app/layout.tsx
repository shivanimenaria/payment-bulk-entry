import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UIProvider } from "@/components/ui/toast-confirm";
import { SessionProvider } from "@/lib/auth-context";
import { EmbeddedNavigationReporter } from "@/components/embedded/EmbeddedNavigationReporter";
import { EmbeddedLogoutListener } from "@/components/embedded/EmbeddedLogoutListener";

export const metadata: Metadata = {
  title: "Bulk Payment Entry",
  description: "Record one vendor payment and allocate it across rDash payment requests",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-gilroy antialiased bg-gray-50">
        <Suspense>
          <EmbeddedNavigationReporter />
          <EmbeddedLogoutListener />
          <SessionProvider>
            <UIProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </UIProvider>
          </SessionProvider>
        </Suspense>
      </body>
    </html>
  );
}
