/**
 * POST /api/projects — create a project from a topic and/or materials and
 * queue the outputs the student picked. Body:
 * { title?, topic?, tier?, folderId?, materials?: [{kind, name, content}], outputs: OutputType[] }
 */
import { requireApiUser } from "@/lib/auth/dal";
import { getAIConfig } from "@/lib/ai/config";
import { getEngine } from "@/lib/ai/engine";
import { handleInputError, handleRouteError, jsonError, NO_STORE, readJson } from "@/lib/ai/http";
import { createProject } from "@/lib/data/projects";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseNewProject } from "@/lib/validation";

const MAX_BODY_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireApiUser();
    const cfg = getAIConfig();
    const limit = checkRateLimit(`create:${user.id}`, cfg.rateLimit.max, cfg.rateLimit.windowMs);
    if (!limit.allowed) {
      return jsonError(429, { error: "You're creating projects very quickly. Please wait a few minutes.", code: "RATE_LIMITED" }, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }
    const input = parseNewProject(await readJson(request, MAX_BODY_BYTES), cfg.maxSourceWords);
    const { projectId, generationIds } = await createProject(user.id, input);
    await getEngine().enqueue(generationIds);
    return Response.json({ id: projectId }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return handleInputError(err) ?? handleRouteError(err);
  }
}
