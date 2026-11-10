/**
 * GET /api/health — status probe for the sidebar indicator and settings page.
 * Never exposes the private server URL.
 */
import { getAIConfig } from "@/lib/ai/config";
import { WARMING_UP_MESSAGE } from "@/lib/ai/errors";
import { NO_STORE } from "@/lib/ai/http";
import { checkServer } from "@/lib/ai/ollama";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let cfg: ReturnType<typeof getAIConfig>;
  try {
    cfg = getAIConfig();
  } catch {
    return Response.json({ status: "misconfigured" }, { status: 500, headers: NO_STORE });
  }

  try {
    const { modelInstalled, models } = await checkServer(cfg, undefined, 3_000);
    return Response.json(
      { status: modelInstalled ? "online" : "model_missing", model: cfg.model, installedModels: modelInstalled ? undefined : models },
      { status: modelInstalled ? 200 : 503, headers: NO_STORE },
    );
  } catch {
    return Response.json({ status: "offline", model: cfg.model, error: WARMING_UP_MESSAGE }, { status: 503, headers: NO_STORE });
  }
}
