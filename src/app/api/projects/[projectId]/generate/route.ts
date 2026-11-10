/** POST /api/projects/[projectId]/generate — create or regenerate outputs. Body: { outputs: OutputType[] } */
import { requireApiUser } from "@/lib/auth/dal";
import { getAIConfig } from "@/lib/ai/config";
import { getEngine } from "@/lib/ai/engine";
import { handleInputError, handleRouteError, jsonError, NO_STORE, readJson } from "@/lib/ai/http";
import { queueGenerations } from "@/lib/data/projects";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseOutputs } from "@/lib/validation";

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/generate">): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { projectId } = await ctx.params;
    const cfg = getAIConfig();
    const limit = checkRateLimit(`create:${user.id}`, cfg.rateLimit.max, cfg.rateLimit.windowMs);
    if (!limit.allowed) {
      return jsonError(429, { error: "You're generating very quickly. Please wait a few minutes.", code: "RATE_LIMITED" });
    }
    const body = (await readJson(request, 64 * 1024)) as { outputs?: unknown };
    const ids = await queueGenerations(user.id, projectId, parseOutputs(body?.outputs));
    await getEngine().enqueue(ids);
    return Response.json({ queued: ids.length }, { headers: NO_STORE });
  } catch (err) {
    return handleInputError(err) ?? handleRouteError(err);
  }
}
