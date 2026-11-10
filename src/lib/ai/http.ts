import "server-only";

import type { ApiErrorBody } from "../types";
import { UnauthorizedError } from "../auth/dal";
import { NotFoundError } from "../data/projects";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonError(status: number, body: ApiErrorBody, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Map common failures in route handlers to JSON errors. */
export function handleRouteError(err: unknown): Response {
  if (err instanceof UnauthorizedError) return jsonError(401, { error: err.message, code: "UNAUTHORIZED" });
  if (err instanceof NotFoundError) return jsonError(404, { error: err.message, code: "NOT_FOUND" });
  console.error("[study-suite] route error", err);
  return jsonError(500, { error: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}

/** Read a JSON body with a size cap. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new PayloadTooLargeError();
  const raw = await request.text();
  if (raw.length > maxBytes) throw new PayloadTooLargeError();
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("Request body must be valid JSON.");
  }
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super("That's too much material for one upload. Please split it into smaller parts.");
    this.name = "PayloadTooLargeError";
  }
}

export function handleInputError(err: unknown): Response | null {
  if (err instanceof BadRequestError) return jsonError(400, { error: err.message, code: "BAD_REQUEST" });
  if (err instanceof PayloadTooLargeError) return jsonError(413, { error: err.message, code: "PAYLOAD_TOO_LARGE" });
  return null;
}
