/**
 * POST /api/generate — the internal data pipeline.
 *
 * Body: { sourceText: string, contextTier: "standard" | "deep_dive" }
 *
 * Responds with the StudySuiteResponse JSON. If the request sends
 * `Accept: application/x-ndjson`, progress events are streamed one JSON
 * object per line instead, ending with a `result` (or `error`) event.
 *
 * The private AI server address and model come exclusively from server-side
 * environment variables (PRIVATE_AI_URL, AI_MODEL_NAME).
 */

import { getAIConfig } from "@/lib/ai/config";
import { isAbortError, jsonError, NO_STORE, toErrorResponse } from "@/lib/ai/http";
import { AIUnavailableError, checkServer } from "@/lib/ai/ollama";
import { runStudySuitePipeline } from "@/lib/ai/pipeline";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { countWords } from "@/lib/text/chunking";
import { CONTEXT_TIERS, type ContextTier, type GenerateRequestBody, type PipelineEvent } from "@/lib/types";

/** Only used by serverless hosts; a self-hosted `next start` has no limit. */
export const maxDuration = 300;

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MIN_WORDS = 20;
const HEARTBEAT_MS = 15_000;

type Validated = { ok: true; value: GenerateRequestBody } | { ok: false; error: string };

function validate(body: unknown): Validated {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Request body must be a JSON object." };
  const { sourceText, contextTier } = body as Record<string, unknown>;
  if (typeof sourceText !== "string" || !sourceText.trim()) {
    return { ok: false, error: "Please provide some lecture material in `sourceText`." };
  }
  const tier = contextTier ?? "standard";
  if (typeof tier !== "string" || !CONTEXT_TIERS.includes(tier as ContextTier)) {
    return { ok: false, error: "`contextTier` must be either 'standard' or 'deep_dive'." };
  }
  return { ok: true, value: { sourceText: sourceText.replace(/\u0000/g, ""), contextTier: tier as ContextTier } };
}

export async function POST(request: Request): Promise<Response> {
  let cfg: ReturnType<typeof getAIConfig>;
  try {
    cfg = getAIConfig();
  } catch (err) {
    console.error("[study-suite] configuration error:", err);
    return jsonError(500, { error: "The study engine is not configured correctly.", code: "CONFIG_ERROR" });
  }

  // 1. Abuse protection
  const limit = checkRateLimit(clientKey(request), cfg.rateLimit.max, cfg.rateLimit.windowMs);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return jsonError(
      429,
      {
        error: `You're generating study suites very quickly. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
        code: "RATE_LIMITED",
      },
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  // 2. Parse & validate
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return jsonError(413, { error: "That upload is too large. Please split it into smaller parts.", code: "PAYLOAD_TOO_LARGE" });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonError(413, { error: "That upload is too large. Please split it into smaller parts.", code: "PAYLOAD_TOO_LARGE" });
    }
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, { error: "Request body must be valid JSON.", code: "BAD_REQUEST" });
  }

  const validated = validate(body);
  if (!validated.ok) return jsonError(400, { error: validated.error, code: "BAD_REQUEST" });
  const { sourceText, contextTier } = validated.value;

  const words = countWords(sourceText);
  if (words < MIN_WORDS) {
    return jsonError(400, {
      error: `Please provide at least ${MIN_WORDS} words of lecture material so there is something to study.`,
      code: "TOO_SHORT",
    });
  }
  if (words > cfg.maxSourceWords) {
    return jsonError(413, {
      error: `That's ${words.toLocaleString("en-US")} words. The limit is ${cfg.maxSourceWords.toLocaleString("en-US")} words per suite, so please split the material into parts.`,
      code: "TOO_MANY_WORDS",
    });
  }

  // 3. Preflight: fail fast with a friendly 503 if the private AI server is down.
  try {
    const status = await checkServer(cfg, request.signal);
    if (!status.modelInstalled) {
      throw new AIUnavailableError(
        `Model "${cfg.model}" is not installed on the AI server (run: ollama pull ${cfg.model}).`,
        "MODEL_NOT_FOUND",
      );
    }
  } catch (err) {
    const { status, body: errorBody } = toErrorResponse(err);
    return jsonError(status, errorBody, status === 503 ? { "Retry-After": "30" } : {});
  }

  // Abort the upstream generation as soon as the student goes away.
  // (No custom reason: downstream code then always sees a standard AbortError.)
  const abort = new AbortController();
  const onClientAbort = () => abort.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const wantsStream = (request.headers.get("accept") ?? "").includes("application/x-ndjson");

  // 4a. Plain JSON response
  if (!wantsStream) {
    try {
      const result = await runStudySuitePipeline({ cfg, sourceText, tier: contextTier, signal: abort.signal });
      return Response.json(result, { headers: NO_STORE });
    } catch (err) {
      if (abort.signal.aborted || isAbortError(err)) return new Response(null, { status: 499 });
      const { status, body: errorBody } = toErrorResponse(err);
      return jsonError(status, errorBody);
    } finally {
      request.signal.removeEventListener("abort", onClientAbort);
    }
  }

  // 4b. NDJSON progress stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (line: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          open = false;
        }
      };
      const send = (event: PipelineEvent) => write(`${JSON.stringify(event)}\n`);
      // Blank lines keep reverse proxies from closing the connection while a long prompt is evaluated.
      const heartbeat = setInterval(() => write("\n"), HEARTBEAT_MS);

      try {
        const result = await runStudySuitePipeline({
          cfg,
          sourceText,
          tier: contextTier,
          signal: abort.signal,
          emit: send,
        });
        send({ type: "result", data: result });
      } catch (err) {
        if (!abort.signal.aborted && !isAbortError(err)) {
          const { status, body: errorBody } = toErrorResponse(err);
          send({ type: "error", status, ...errorBody });
        }
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onClientAbort);
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
