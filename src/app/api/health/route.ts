/**
 * GET /api/health — lightweight status probe for the dashboard's status pill.
 * Never exposes the private server URL.
 */

import { connection } from "next/server";
import { getAIConfig } from "@/lib/ai/config";
import { NO_STORE, WARMING_UP_MESSAGE } from "@/lib/ai/http";
import { checkServer } from "@/lib/ai/ollama";

export async function GET(): Promise<Response> {
  await connection(); // always evaluated at request time

  let cfg: ReturnType<typeof getAIConfig>;
  try {
    cfg = getAIConfig();
  } catch {
    return Response.json({ status: "misconfigured" }, { status: 500, headers: NO_STORE });
  }

  try {
    const { modelInstalled } = await checkServer(cfg, undefined, 3_000);
    return Response.json(
      { status: modelInstalled ? "online" : "model_missing", model: cfg.model },
      { status: modelInstalled ? 200 : 503, headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { status: "offline", model: cfg.model, error: WARMING_UP_MESSAGE },
      { status: 503, headers: NO_STORE },
    );
  }
}
