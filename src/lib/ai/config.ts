import "server-only";

import os from "node:os";

/**
 * Server-only configuration. Nothing here is ever sent to the browser:
 * none of these variables use the NEXT_PUBLIC_ prefix.
 *
 * Speed and memory: Ollama reloads the whole model whenever a request asks
 * for a different context size (num_ctx), which is slow and briefly needs
 * extra memory. So every request uses the SAME context size, chosen once from
 * how much memory this computer has (or set with AI_CONTEXT_SIZE).
 */

export type MemoryMode = "light" | "balanced" | "roomy" | "custom";

export interface AIConfig {
  baseUrl: string;
  model: string;
  /** Optional bearer token for servers behind an authenticating reverse proxy. */
  apiKey?: string;
  /** Context window used for every request (Ollama `num_ctx`). Never varies, so the model is never reloaded. */
  contextSize: number;
  /** Upper bound on tokens generated per request (Ollama `num_predict`). */
  maxPredict: number;
  temperature: number;
  keepAlive: string;
  /** Hard ceiling for a single model call, in ms. */
  requestTimeoutMs: number;
  maxSourceWords: number;
  rateLimit: { max: number; windowMs: number };
  /** How the defaults were picked, shown on the Settings page. */
  memory: { mode: MemoryMode; totalGb: number; localAI: boolean };
}

function intFromEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function floatFromEnv(name: string, fallback: number): number {
  const value = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(value) ? value : fallback;
}

const PROFILES: Record<Exclude<MemoryMode, "custom">, { contextSize: number; keepAlive: string }> = {
  // 8 GB laptops: the model alone takes a big share, so keep everything small
  // and let Ollama free the memory soon after you stop.
  light: { contextSize: 6_144, keepAlive: "5m" },
  balanced: { contextSize: 8_192, keepAlive: "10m" },
  roomy: { contextSize: 12_288, keepAlive: "15m" },
};

export function pickMemoryMode(totalGb: number, localAI: boolean): Exclude<MemoryMode, "custom"> {
  if (!localAI) return "balanced"; // the model runs on another machine; this one's memory says nothing about it
  if (totalGb < 12) return "light";
  if (totalGb < 24) return "balanced";
  return "roomy";
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

let cached: AIConfig | null = null;

export function getAIConfig(): AIConfig {
  if (cached) return cached;

  const rawUrl = (process.env.PRIVATE_AI_URL || "http://localhost:11434").trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    throw new Error("PRIVATE_AI_URL must be an absolute http(s) URL, e.g. http://localhost:11434");
  }
  const baseUrl = url.toString().replace(/\/+$/, "");

  const totalGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const localAI = isLocalHost(url.hostname);
  const auto = pickMemoryMode(totalGb, localAI);
  // AI_MAX_CONTEXT and AI_NUM_CTX are accepted as older names for AI_CONTEXT_SIZE.
  const contextOverride = intFromEnv("AI_CONTEXT_SIZE", intFromEnv("AI_MAX_CONTEXT", intFromEnv("AI_NUM_CTX", 0, 2048), 2048), 2048);
  const contextSize = Math.min(131_072, contextOverride || PROFILES[auto].contextSize);

  cached = {
    baseUrl,
    model: (process.env.AI_MODEL_NAME || "llama3.1").trim(),
    apiKey: process.env.PRIVATE_AI_API_KEY?.trim() || undefined,
    contextSize,
    maxPredict: intFromEnv("AI_NUM_PREDICT", 4_096, 256),
    temperature: floatFromEnv("AI_TEMPERATURE", 0.3),
    keepAlive: process.env.AI_KEEP_ALIVE?.trim() || PROFILES[auto].keepAlive,
    requestTimeoutMs: intFromEnv("AI_REQUEST_TIMEOUT_MS", 15 * 60_000, 10_000),
    maxSourceWords: intFromEnv("MAX_SOURCE_WORDS", 120_000, 1000),
    rateLimit: {
      max: intFromEnv("RATE_LIMIT_MAX", 60, 0),
      windowMs: intFromEnv("RATE_LIMIT_WINDOW_MS", 60 * 60_000, 1000),
    },
    memory: { mode: contextOverride ? "custom" : auto, totalGb, localAI },
  };
  return cached;
}

/* -------------------------------------------------------------------------- */
/* The context size actually in use                                           */
/* -------------------------------------------------------------------------- */

const g = globalThis as unknown as { __aiContextSize?: number };

/** The context size every request uses right now (it only ever goes down, after an out-of-memory error). */
export function activeContextSize(cfg: AIConfig): number {
  return Math.min(g.__aiContextSize ?? cfg.contextSize, cfg.contextSize);
}

/**
 * The computer ran out of memory: use a smaller context from now on (until the
 * app restarts), so every later request fits too. Returns false when it can't
 * go any smaller.
 */
export function shrinkContextSize(cfg: AIConfig): boolean {
  const current = activeContextSize(cfg);
  if (current <= 2048) return false;
  g.__aiContextSize = Math.max(2048, Math.floor((current * 0.6) / 1024) * 1024);
  console.warn(`[study-suite] out of memory: using a ${g.__aiContextSize}-token context from now on (was ${current}).`);
  return true;
}

/** Rough, deliberately pessimistic token estimate (about 3.2 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}
