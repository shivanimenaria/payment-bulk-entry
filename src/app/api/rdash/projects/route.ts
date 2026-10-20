import { NextRequest } from "next/server";
import { getSessionOrMock } from "@/lib/server/auth";
import { getRdashSource } from "@/lib/server/rdash-source";
import { safeJson } from "@/lib/server/respond-safe";
import { rdashRouteError } from "@/lib/server/route-errors";

export const dynamic = "force-dynamic";

// GET /api/rdash/projects → { projects: [{ id, name }] } (all pages).
// Ids are passed through exactly as rDash returned them.
export async function GET(request: NextRequest) {
  try {
    const { auth } = await getSessionOrMock(request);
    const projects = await getRdashSource(auth).listProjects();
    return safeJson({ projects: projects.map((p) => ({ id: p.id, name: p.name })) }, { route: "GET /api/rdash/projects" });
  } catch (err) {
    return rdashRouteError(err, "GET /api/rdash/projects");
  }
}
