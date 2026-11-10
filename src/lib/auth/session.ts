import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { read, schema, write } from "../db";

export const SESSION_COOKIE = "sss_session";
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Mark cookies Secure only when the request really arrived over HTTPS (plain-HTTP LAN access must keep working). */
async function isHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return process.env.SECURE_COOKIES === "true";
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await write((db) => {
    // Opportunistically clear expired sessions.
    db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())).run();
    db.insert(schema.sessions).values({ id: hashToken(token), userId, expiresAt }).run();
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: "/",
    expires: expiresAt,
  });
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function readSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return read((db) => {
    const row = db
      .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
      .get();
    return row ?? null;
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await write((db) => db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token))).run());
  }
  store.delete(SESSION_COOKIE);
}

/** Sign out every device except the current one (after a password change). */
export async function destroyOtherSessions(userId: string): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const keep = token ? hashToken(token) : "";
  await write((db) => {
    const all = db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, userId)).all();
    for (const s of all) {
      if (s.id !== keep) db.delete(schema.sessions).where(eq(schema.sessions.id, s.id)).run();
    }
  });
}
