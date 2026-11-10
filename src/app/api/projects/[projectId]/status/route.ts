/** GET /api/projects/[projectId]/status — live status of every output in a project. */
import { requireApiUser } from "@/lib/auth/dal";
import { getEngine } from "@/lib/ai/engine";
import { handleRouteError, jsonError, NO_STORE } from "@/lib/ai/http";
import { getProjectBundle } from "@/lib/data/projects";
import type { GenerationStatusView } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[projectId]/status">): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { projectId } = await ctx.params;
    const engine = getEngine();
    await engine.ensureStarted();
    const bundle = await getProjectBundle(user.id, projectId);
    if (!bundle) return jsonError(404, { error: "That project could not be found.", code: "NOT_FOUND" });
    const outputs: GenerationStatusView[] = bundle.generations.map((g) => ({
      id: g.id,
      type: g.type,
      status: g.status,
      error: g.error,
      hasContent: Boolean(g.content),
      progress: engine.progress(g.id),
    }));
    return Response.json({ outputs }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
