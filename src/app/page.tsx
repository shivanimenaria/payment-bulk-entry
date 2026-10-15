import { redirect } from "next/navigation";

// Render per request so the redirect is a real HTTP 307 with a Location header
// (a statically prerendered redirect only works client-side).
export const dynamic = "force-dynamic";

export default function Home() {
  redirect("/payments");
}
