/** POST /api/projects/[projectId]/materials — add pasted text or extracted files. Body: { materials: [...] } */
import { requireApiUser } from "@/lib/auth/dal";
import { getAIConfig } from "@/lib/ai/config";
import { handleInputError, handleRouteError, jsonError, NO_STORE, readJson } from "@/lib/ai/http";
import { addMaterials } from "@/lib/data/projects";
import { parseMaterials } from "@/lib/validation";

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/materials">): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { projectId } = await ctx.params;
    const body = (await readJson(request, 12 * 1024 * 1024)) as { materials?: unknown };
    const materials = parseMaterials(body?.materials, getAIConfig().maxSourceWords);
    if (!materials.length) return jsonError(400, { error: "There was no text to add.", code: "BAD_REQUEST" });
    await addMaterials(user.id, projectId, materials);
    return Response.json({ added: materials.length }, { headers: NO_STORE });
  } catch (err) {
    return handleInputError(err) ?? handleRouteError(err);
  }
}
