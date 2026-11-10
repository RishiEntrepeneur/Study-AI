import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { readSessionUser, type SessionUser } from "./session";

/**
 * Data Access Layer entry point: every page, action and route handler that
 * touches user data calls one of these, so authorisation is never forgotten.
 */

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => readSessionUser());

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("You need to be signed in.");
    this.name = "UnauthorizedError";
  }
}

/** For route handlers: throw instead of redirecting. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
