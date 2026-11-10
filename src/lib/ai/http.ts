import "server-only";

import type { ApiErrorBody } from "../types";
import { ModelOutputError } from "./normalize";
import { AITimeoutError, AIUnavailableError, AIUpstreamError } from "./ollama";

export const WARMING_UP_MESSAGE = "Our private AI server is warming up. Please give it a few moments!";

const exposeDetails = process.env.NODE_ENV !== "production";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonError(status: number, body: ApiErrorBody, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Map pipeline failures to student-friendly HTTP errors. Internals are logged, not leaked. */
export function toErrorResponse(err: unknown): { status: number; body: ApiErrorBody } {
  const withDetail = (body: ApiErrorBody, detail?: string): ApiErrorBody =>
    exposeDetails && detail ? { ...body, detail } : body;

  if (err instanceof AIUnavailableError) {
    console.warn(`[study-suite] AI unavailable (${err.code}): ${err.detail}`);
    return { status: 503, body: withDetail({ error: WARMING_UP_MESSAGE, code: err.code }, err.detail) };
  }
  if (err instanceof AITimeoutError) {
    console.warn("[study-suite] AI request timed out");
    return {
      status: 504,
      body: {
        error: "The private AI server took too long on this material. Please try again, or split it into smaller parts.",
        code: "AI_TIMEOUT",
      },
    };
  }
  if (err instanceof ModelOutputError) {
    console.warn(`[study-suite] unusable model output: ${err.message}`);
    return {
      status: 502,
      body: withDetail(
        { error: "The AI returned an unreadable study suite. Please try again.", code: "MODEL_OUTPUT_INVALID" },
        err.message,
      ),
    };
  }
  if (err instanceof AIUpstreamError) {
    console.error(`[study-suite] AI upstream error ${err.status}: ${err.detail}`);
    return {
      status: 502,
      body: withDetail(
        { error: "The private AI server reported an error. Please try again in a moment.", code: "AI_UPSTREAM_ERROR" },
        err.detail,
      ),
    };
  }
  console.error("[study-suite] unexpected pipeline error", err);
  return { status: 500, body: { error: "Something went wrong while building your study suite.", code: "INTERNAL_ERROR" } };
}
