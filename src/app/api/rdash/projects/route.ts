import { NextRequest } from "next/server";
import { getSessionOrMock, withAuthCookies } from "@/lib/server/auth";
import { getRdashSource } from "@/lib/server/rdash-source";
import { safeJson } from "@/lib/server/respond-safe";
import { rdashRouteError, withCookieHeader } from "@/lib/server/route-errors";

export const dynamic = "force-dynamic";

// GET /api/rdash/projects → { projects: [{ id, name }] } (all pages).
// Ids are passed through exactly as rDash returned them.
export const GET = withAuthCookies(async (request: NextRequest) => {
  try {
    const { auth, cookieHeader } = await getSessionOrMock(request);
    const projects = await getRdashSource(auth).listProjects();
    return withCookieHeader(
      safeJson({ projects: projects.map((p) => ({ id: p.id, name: p.name })) }, { route: "GET /api/rdash/projects" }),
      cookieHeader,
    );
  } catch (err) {
    return rdashRouteError(err, "GET /api/rdash/projects");
  }
});
