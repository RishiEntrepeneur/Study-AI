import "server-only";

/**
 * Server-only configuration. Nothing here is ever sent to the browser:
 * none of these variables use the NEXT_PUBLIC_ prefix.
 */

export interface AIConfig {
  baseUrl: string;
  model: string;
  /** Optional bearer token for servers behind an authenticating reverse proxy. */
  apiKey?: string;
  /**
   * Largest context window ever requested (Ollama `num_ctx`). Each request asks
   * only for what it needs, which keeps memory use low on small machines.
   */
  maxContext: number;
  /** Upper bound on tokens generated per request (Ollama `num_predict`). */
  maxPredict: number;
  temperature: number;
  keepAlive: string;
  /** Hard ceiling for a single model call, in ms. */
  requestTimeoutMs: number;
  maxSourceWords: number;
  rateLimit: { max: number; windowMs: number };
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

let cached: AIConfig | null = null;

export function getAIConfig(): AIConfig {
  if (cached) return cached;

  const rawUrl = (process.env.PRIVATE_AI_URL || "http://localhost:11434").trim();
  let baseUrl: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
    baseUrl = url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("PRIVATE_AI_URL must be an absolute http(s) URL, e.g. http://localhost:11434");
  }

  cached = {
    baseUrl,
    model: (process.env.AI_MODEL_NAME || "llama3.1").trim(),
    apiKey: process.env.PRIVATE_AI_API_KEY?.trim() || undefined,
    // AI_NUM_CTX is accepted as an older name for the same setting.
    maxContext: intFromEnv("AI_MAX_CONTEXT", intFromEnv("AI_NUM_CTX", 32_768, 2048), 2048),
    maxPredict: intFromEnv("AI_NUM_PREDICT", 8_192, 256),
    temperature: floatFromEnv("AI_TEMPERATURE", 0.3),
    keepAlive: process.env.AI_KEEP_ALIVE?.trim() || "30m",
    requestTimeoutMs: intFromEnv("AI_REQUEST_TIMEOUT_MS", 15 * 60_000, 10_000),
    maxSourceWords: intFromEnv("MAX_SOURCE_WORDS", 120_000, 1000),
    rateLimit: {
      max: intFromEnv("RATE_LIMIT_MAX", 60, 0),
      windowMs: intFromEnv("RATE_LIMIT_WINDOW_MS", 60 * 60_000, 1000),
    },
  };
  return cached;
}
