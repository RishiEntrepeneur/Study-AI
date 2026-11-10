import "server-only";

import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import type { AIConfig } from "./config";

/**
 * Minimal Ollama client (GET /api/tags, POST /api/show, streaming POST /api/chat)
 * built for long jobs on modest hardware.
 *
 * Header/body timeouts are disabled on purpose: a CPU-only server can spend
 * minutes evaluating a long prompt before the first token arrives. An overall
 * deadline is enforced with AbortSignal instead.
 */
const dispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connect: { timeout: 10_000 },
  keepAliveTimeout: 30_000,
});

/** The AI server can't be reached or can't serve the model right now. */
export class AIUnavailableError extends Error {
  constructor(
    public readonly detail: string,
    public readonly code: "AI_UNREACHABLE" | "MODEL_NOT_FOUND" | "AI_BUSY" = "AI_UNREACHABLE",
  ) {
    super(detail);
    this.name = "AIUnavailableError";
  }
}

/** The AI server answered with an unexpected error. */
export class AIUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`AI server error ${status}: ${detail}`);
    this.name = "AIUpstreamError";
  }
}

/** The machine running the model doesn't have enough free memory for this request. */
export class AIMemoryError extends AIUpstreamError {
  constructor(detail: string) {
    super(500, detail);
    this.name = "AIMemoryError";
  }
}

/** A single model call exceeded AI_REQUEST_TIMEOUT_MS. */
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

const MEMORY_PATTERN =
  /requires more system memory|more memory than is available|out of memory|insufficient memory|not enough memory|failed to allocate|cudaMalloc|unable to allocate|memory allocation|OOM/i;

export function isAbortError(err: unknown): boolean {
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

function rethrowTransport(err: unknown, signal?: AbortSignal): never {
  if (signal?.aborted && !isTimeout(signal.reason)) throw signal.reason ?? err;
  if (isTimeout(err)) throw new AITimeoutError();
  if (isAbortError(err)) throw err;
  if (isNetworkError(err)) throw new AIUnavailableError("Could not connect to the private AI server.");
  throw err;
}

function upstreamError(status: number, detail: string, model: string): Error {
  if (MEMORY_PATTERN.test(detail)) return new AIMemoryError(detail);
  if (status === 404 && /not found|pull/i.test(detail)) {
    return new AIUnavailableError(`Model "${model}" is not installed on the AI server (run: ollama pull ${model}).`, "MODEL_NOT_FOUND");
  }
  if (status === 502 || status === 503 || status === 504) return new AIUnavailableError(detail, "AI_BUSY");
  return new AIUpstreamError(status, detail);
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
    rethrowTransport(err, signal);
  }
  if (!res.ok) {
    throw new AIUnavailableError(`Health probe failed: ${await errorText(res)}`, res.status === 503 ? "AI_BUSY" : "AI_UNREACHABLE");
  }
  const data = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string; model?: string }> };
  const models = (data.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
  return { models, modelInstalled: models.some((name) => modelMatches(name, cfg.model)) };
}

/* -------------------------------------------------------------------------- */
/* Model capabilities (thinking models need `think: false`)                   */
/* -------------------------------------------------------------------------- */

const capabilityCache = new Map<string, Promise<string[]>>();

async function fetchCapabilities(cfg: AIConfig): Promise<string[]> {
  try {
    const res = await undiciFetch(`${cfg.baseUrl}/api/show`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify({ model: cfg.model }),
      signal: AbortSignal.timeout(10_000),
      dispatcher,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { capabilities?: unknown };
    return Array.isArray(data.capabilities) ? data.capabilities.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return []; // older servers: assume a plain chat model
  }
}

export function getCapabilities(cfg: AIConfig): Promise<string[]> {
  const key = `${cfg.baseUrl}|${cfg.model}`;
  let entry = capabilityCache.get(key);
  if (!entry) {
    entry = fetchCapabilities(cfg);
    capabilityCache.set(key, entry);
    // Don't cache failures forever: re-check after a minute.
    entry.then((caps) => caps.length === 0 && setTimeout(() => capabilityCache.delete(key), 60_000));
  }
  return entry;
}

/* -------------------------------------------------------------------------- */
/* Streaming chat                                                             */
/* -------------------------------------------------------------------------- */

export interface ChatMessageParam {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatParams {
  cfg: AIConfig;
  messages: ChatMessageParam[];
  /** JSON schema (structured output) or "json"; omit for free text. */
  format?: object | "json";
  numCtx: number;
  numPredict: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Called with each streamed text piece (after any <think> block is removed). */
  onText?: (piece: string) => void;
  /** Called periodically with the number of streamed tokens so far. */
  onProgress?: (tokens: number) => void;
}

export interface ChatResult {
  content: string;
  doneReason?: string;
  tokens: number;
}

/** Hides a leading <think>…</think> block from a streamed answer. */
class ThinkFilter {
  private buffer = "";
  private state: "start" | "thinking" | "passthrough" = "start";

  push(piece: string): string {
    if (this.state === "passthrough") return piece;
    this.buffer += piece;
    if (this.state === "start") {
      const trimmed = this.buffer.trimStart();
      if (trimmed.length < 7 && "<think>".startsWith(trimmed)) return "";
      if (!trimmed.startsWith("<think>")) {
        this.state = "passthrough";
        const out = this.buffer;
        this.buffer = "";
        return out;
      }
      this.state = "thinking";
    }
    const end = this.buffer.indexOf("</think>");
    if (end === -1) return "";
    const rest = this.buffer.slice(end + 8).replace(/^\s+/, "");
    this.buffer = "";
    this.state = "passthrough";
    return rest;
  }
}

export async function chat(params: ChatParams): Promise<ChatResult> {
  const { cfg, signal, onProgress, onText } = params;
  const deadline = AbortSignal.timeout(cfg.requestTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const capabilities = await getCapabilities(cfg);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: params.messages,
    stream: true,
    keep_alive: cfg.keepAlive,
    options: {
      temperature: params.temperature ?? cfg.temperature,
      num_ctx: params.numCtx,
      num_predict: params.numPredict,
    },
  };
  if (params.format) body.format = params.format;
  if (capabilities.includes("thinking")) body.think = false;

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
    // Older servers don't accept a JSON schema in `format` (or the `think` flag); retry in classic JSON mode.
    if (res.status === 400) {
      const detail = await errorText(res);
      if (/format|schema|think/i.test(detail)) {
        const fallback = { ...body };
        delete fallback.think;
        if (typeof params.format === "object") fallback.format = "json";
        res = await post(fallback);
      } else {
        throw upstreamError(400, detail, cfg.model);
      }
    }
  } catch (err) {
    if (err instanceof AIUpstreamError || err instanceof AIUnavailableError) throw err;
    rethrowTransport(err, signal);
  }

  if (!res.ok) throw upstreamError(res.status, await errorText(res), cfg.model);
  if (!res.body) throw new AIUpstreamError(502, "The AI server returned an empty response.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const think = new ThinkFilter();
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
      return; // keep-alive noise
    }
    if (chunk.error) throw upstreamError(500, chunk.error, cfg.model);
    const piece = chunk.message?.content ?? chunk.response ?? "";
    if (piece) {
      content += piece;
      tokens++;
      const visible = think.push(piece);
      if (visible) onText?.(visible);
    }
    if (chunk.done) doneReason = chunk.done_reason;
    if (onProgress && tokens - lastReported >= 24) {
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
    if (err instanceof AIUpstreamError || err instanceof AIUnavailableError) throw err;
    rethrowTransport(err, signal);
  } finally {
    reader.releaseLock();
  }

  onProgress?.(tokens);
  return { content, doneReason, tokens };
}
