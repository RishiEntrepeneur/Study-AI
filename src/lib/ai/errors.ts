import "server-only";

import { AIMemoryError, AITimeoutError, AIUnavailableError, AIUpstreamError, isAbortError } from "./ollama";
import { ModelOutputError } from "./normalize";

export const WARMING_UP_MESSAGE = "Our private AI server is warming up. Please give it a few moments!";

export interface DescribedError {
  /** Plain-language explanation with a next step. */
  message: string;
  code: string;
  /** HTTP status for API responses. */
  status: number;
  /** Should the app retry automatically after a short wait? */
  transient: boolean;
}

/** Turn any AI failure into something a student can act on. Raw server text is logged, and kept only where it helps. */
export function describeAIError(err: unknown, model: string): DescribedError {
  if (isAbortError(err)) return { message: "Stopped.", code: "CANCELLED", status: 499, transient: false };
  if (err instanceof AIMemoryError) {
    return {
      message: `Your computer ran out of memory for the AI model "${model}". Close other apps (especially browsers with many tabs), or switch to a smaller model, then try again.`,
      code: "AI_OUT_OF_MEMORY",
      status: 503,
      transient: false,
    };
  }
  if (err instanceof AIUnavailableError) {
    if (err.code === "MODEL_NOT_FOUND") {
      return {
        message: `The AI model "${model}" isn't installed. Open a terminal and run: ollama pull ${model}`,
        code: err.code,
        status: 503,
        transient: false,
      };
    }
    return {
      message:
        err.code === "AI_BUSY"
          ? "The AI server is busy right now. It will try again automatically."
          : `${WARMING_UP_MESSAGE} (Make sure Ollama is running.)`,
      code: err.code,
      status: 503,
      transient: true,
    };
  }
  if (err instanceof AITimeoutError) {
    return {
      message: "The AI took too long on this material. Try again, or split the material into smaller projects.",
      code: "AI_TIMEOUT",
      status: 504,
      transient: false,
    };
  }
  if (err instanceof ModelOutputError) {
    return {
      message: "The AI's answer couldn't be read, even after retrying. Try again; if it keeps happening, a larger model usually fixes it.",
      code: "MODEL_OUTPUT_INVALID",
      status: 502,
      transient: false,
    };
  }
  if (err instanceof AIUpstreamError) {
    const detail = err.detail.replace(/\s+/g, " ").slice(0, 200);
    return { message: `The AI server reported a problem: ${detail}`, code: "AI_UPSTREAM_ERROR", status: 502, transient: false };
  }
  console.error("[study-suite] unexpected AI error", err);
  return { message: "Something unexpected went wrong. Please try again.", code: "INTERNAL_ERROR", status: 500, transient: false };
}
