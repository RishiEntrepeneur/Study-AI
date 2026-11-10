import "server-only";

import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import type { AIConfig } from "./config";

/**
 * Minimal Ollama client (POST /api/chat, GET /api/tags) built for long jobs.
 *
 * Header/body timeouts are disabled on purpose: a CPU-only server can spend
 * several minutes evaluating an 8,000-word prompt before the first token
 * arrives, and Node's default 300 s header timeout would misreport that as an
 * outage. An overall deadline is enforced with AbortSignal instead.
 */
const dispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connect: { timeout: 10_000 },
  keepAliveTimeout: 30_000,
});

/** The AI server can't be reached or can't serve the model right now (→ HTTP 503). */
export class AIUnavailableError extends Error {
  constructor(
    public readonly detail: string,
    public readonly code: "AI_UNREACHABLE" | "MODEL_NOT_FOUND" | "AI_BUSY" = "AI_UNREACHABLE",
  ) {
    super(detail);
    this.name = "AIUnavailableError";
  }
}

/** The AI server answered with an unexpected error (→ HTTP 502). */
export class AIUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`AI server error ${status}: ${detail}`);
    this.name = "AIUpstreamError";
  }
}

/** A single model call exceeded AI_REQUEST_TIMEOUT_MS (→ HTTP 504). */
export class AITimeoutError extends Error {
  constructor() {
    super("The private AI server took too long to respond.");
    this.name = "AITimeoutError";
  }
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_CLOSED",
]);

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code ?? (err.cause as { code?: string } | undefined)?.code;
  if (code && NETWORK_CODES.has(code)) return true;
  return err.name === "TypeError" && /fetch failed|terminated|network/i.test(err.message);
}

function rethrowTransport(err: unknown): never {
  if (isTimeout(err)) throw new AITimeoutError();
  if (isAbort(err)) throw err;
  if (isNetworkError(err)) throw new AIUnavailableError("Could not connect to the private AI server.");
  throw err;
}

function headers(cfg: AIConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/x-ndjson, application/json",
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
  };
}

async function errorText(res: UndiciResponse): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 300) || res.statusText || `HTTP ${res.status}`;
}

function modelMatches(installed: string, wanted: string): boolean {
  if (installed === wanted) return true;
  return !wanted.includes(":") && installed === `${wanted}:latest`;
}

export interface ServerStatus {
  modelInstalled: boolean;
  models: string[];
}

/** Fast reachability probe (GET /api/tags). Throws AIUnavailableError when the server is down. */
export async function checkServer(cfg: AIConfig, signal?: AbortSignal, timeoutMs = 5_000): Promise<ServerStatus> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: UndiciResponse;
  try {
    res = await undiciFetch(`${cfg.baseUrl}/api/tags`, {
      method: "GET",
      headers: headers(cfg),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      dispatcher,
    });
  } catch (err) {
    if (isTimeout(err)) throw new AIUnavailableError("The private AI server did not answer the health probe in time.");
    rethrowTransport(err);
  }
  if (!res.ok) {
    throw new AIUnavailableError(`Health probe failed: ${await errorText(res)}`, res.status === 503 ? "AI_BUSY" : "AI_UNREACHABLE");
  }
  const data = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string; model?: string }> };
  const models = (data.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
  return { models, modelInstalled: models.some((name) => modelMatches(name, cfg.model)) };
}

export interface ChatJSONParams {
  cfg: AIConfig;
  system: string;
  user: string;
  /** JSON schema for Ollama structured outputs; falls back to plain JSON mode on old servers. */
  schema?: object;
  numCtx?: number;
  numPredict?: number;
  signal?: AbortSignal;
  /** Called periodically with the number of streamed tokens so far. */
  onProgress?: (tokens: number) => void;
}

export interface ChatJSONResult {
  content: string;
  doneReason?: string;
  tokens: number;
}

/** Stream a JSON-mode chat completion from Ollama and return the full text. */
export async function chatJSON(params: ChatJSONParams): Promise<ChatJSONResult> {
  const { cfg, schema, signal, onProgress } = params;
  const deadline = AbortSignal.timeout(cfg.requestTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;

  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    stream: true,
    format: schema ?? "json",
    keep_alive: cfg.keepAlive,
    options: {
      temperature: cfg.temperature,
      num_ctx: params.numCtx ?? cfg.numCtx,
      num_predict: params.numPredict ?? cfg.numPredict,
    },
  };

  const post = (payload: unknown) =>
    undiciFetch(`${cfg.baseUrl}/api/chat`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(payload),
      signal: combined,
      dispatcher,
    });

  let res: UndiciResponse;
  try {
    res = await post(body);
    // Ollama < 0.5 doesn't accept a JSON schema in `format`; retry with classic JSON mode.
    if (res.status === 400 && schema) {
      const detail = await errorText(res);
      if (!/format|schema/i.test(detail)) throw new AIUpstreamError(400, detail);
      res = await post({ ...body, format: "json" });
    }
  } catch (err) {
    if (err instanceof AIUpstreamError) throw err;
    rethrowTransport(err);
  }

  if (!res.ok) {
    const detail = await errorText(res);
    if (res.status === 404) {
      throw new AIUnavailableError(
        `Model "${cfg.model}" is not installed on the AI server (run: ollama pull ${cfg.model}). ${detail}`,
        "MODEL_NOT_FOUND",
      );
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new AIUnavailableError(detail, "AI_BUSY");
    throw new AIUpstreamError(res.status, detail);
  }
  if (!res.body) throw new AIUpstreamError(502, "The AI server returned an empty body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let tokens = 0;
  let doneReason: string | undefined;
  let lastReported = 0;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let chunk: { message?: { content?: string }; response?: string; done?: boolean; done_reason?: string; error?: string };
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      return; // ignore keep-alive noise
    }
    if (chunk.error) throw new AIUpstreamError(500, chunk.error);
    const piece = chunk.message?.content ?? chunk.response ?? "";
    if (piece) {
      content += piece;
      tokens++;
    }
    if (chunk.done) doneReason = chunk.done_reason;
    if (onProgress && tokens - lastReported >= 32) {
      lastReported = tokens;
      onProgress(tokens);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    handleLine(buffer);
  } catch (err) {
    if (err instanceof AIUpstreamError) throw err;
    rethrowTransport(err);
  } finally {
    reader.releaseLock();
  }

  onProgress?.(tokens);
  return { content, doneReason, tokens };
}
