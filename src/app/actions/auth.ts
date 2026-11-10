"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { read, schema, write } from "@/lib/db";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroyOtherSessions, destroySession } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/dal";
import { checkRateLimit } from "@/lib/rateLimit";

export interface FormState {
  error?: string;
  fields?: Record<string, string>;
  success?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, "name");
  const email = field(formData, "email").toLowerCase();
  const password = (formData.get("password") as string | null) ?? "";
  const fields = { name, email };

  if (process.env.ALLOW_SIGNUPS === "false") {
    return { error: "New sign-ups are turned off on this server. Ask the person who runs it for an account.", fields };
  }
  if (!name || name.length > 60) return { error: "Enter your name (up to 60 characters).", fields };
  if (!EMAIL_RE.test(email) || email.length > 200) return { error: "Enter a valid email address.", fields };
  if (password.length < 8) return { error: "Use a password with at least 8 characters.", fields };
  if (password.length > 200) return { error: "That password is too long (200 characters max).", fields };

  const limit = checkRateLimit(`signup:${await clientIp()}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) return { error: "Too many sign-up attempts. Please try again later.", fields };

  const existing = await read((db) => db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get());
  if (existing) return { error: "An account with this email already exists. Try logging in instead.", fields };

  const passwordHash = await hashPassword(password);
  const user = await write((db) =>
    db.insert(schema.users).values({ name, email, passwordHash }).returning({ id: schema.users.id }).get(),
  );
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email").toLowerCase();
  const password = (formData.get("password") as string | null) ?? "";
  const fields = { email };
  if (!email || !password) return { error: "Enter your email and password.", fields };

  const limit = checkRateLimit(`login:${await clientIp()}:${email}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`, fields };
  }

  const user = await read((db) =>
    db.select({ id: schema.users.id, passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.email, email)).get(),
  );
  // Always run a hash comparison so response time doesn't reveal which emails exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) return { error: "That email and password don't match.", fields };

  await createSession(user.id);
  redirect(safeNext(field(formData, "next")));
}

export async function logOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = field(formData, "name");
  if (!name || name.length > 60) return { error: "Enter a name (up to 60 characters)." };
  await write((db) => db.update(schema.users).set({ name }).where(eq(schema.users.id, user.id)).run());
  return { success: "Name updated." };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = (formData.get("current") as string | null) ?? "";
  const next = (formData.get("next") as string | null) ?? "";
  if (next.length < 8) return { error: "Use a new password with at least 8 characters." };
  if (next.length > 200) return { error: "That password is too long (200 characters max)." };

  const row = await read((db) =>
    db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id)).get(),
  );
  if (!row || !(await verifyPassword(current, row.passwordHash))) return { error: "Your current password is incorrect." };

  const passwordHash = await hashPassword(next);
  await write((db) => db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id)).run());
  await destroyOtherSessions(user.id);
  return { success: "Password changed. Other devices have been signed out." };
}

export async function deleteAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const password = (formData.get("password") as string | null) ?? "";
  const row = await read((db) =>
    db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id)).get(),
  );
  if (!row || !(await verifyPassword(password, row.passwordHash))) return { error: "That password is incorrect." };
  await destroySession();
  await write((db) => db.delete(schema.users).where(eq(schema.users.id, user.id)).run());
  redirect("/signup");
}
