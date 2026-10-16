"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-context";

// "/" → /payments, carrying the session params (orgId/projectId/userId/
// vendorId) via buildUrl so middleware keeps the cookie in sync.
export default function Home() {
  const router = useRouter();
  const { buildUrl } = useSession();

  useEffect(() => {
    router.replace(buildUrl("/payments"));
    // buildUrl reads window.location; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
