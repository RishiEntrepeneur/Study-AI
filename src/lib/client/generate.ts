/**
 * Client for POST /api/generate. Requests the NDJSON progress stream so the
 * dashboard can show real pipeline progress, and surfaces friendly errors.
 */

import type { ApiErrorBody, GenerateRequestBody, PipelineEvent, StudySuiteResponse } from "../types";

export class GenerateError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "GenerateError";
  }
}

export async function generateStudySuite(
  body: GenerateRequestBody,
  options: { signal?: AbortSignal; onEvent?: (event: PipelineEvent) => void } = {},
): Promise<StudySuiteResponse> {
  let res: Response;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new GenerateError("We couldn't reach the study engine. Check your connection and try again.", 0, "NETWORK");
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new GenerateError(data?.error ?? `Unexpected server error (${res.status}).`, res.status, data?.code);
  }

  if (!res.body || res.headers.get("content-type")?.includes("application/json")) {
    return (await res.json()) as StudySuiteResponse;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: StudySuiteResponse | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return; // heartbeat
    const event = JSON.parse(line) as PipelineEvent;
    if (event.type === "error") throw new GenerateError(event.error, event.status, event.code);
    if (event.type === "result") result = event.data;
    options.onEvent?.(event);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    handle(buffer + decoder.decode());
  } catch (err) {
    if (err instanceof GenerateError || (err instanceof DOMException && err.name === "AbortError")) throw err;
    throw new GenerateError("The connection to the study engine was interrupted. Please try again.", 0, "STREAM_INTERRUPTED");
  }

  if (!result) {
    throw new GenerateError("The study engine closed the connection before finishing. Please try again.", 0, "INCOMPLETE");
  }
  return result;
}
