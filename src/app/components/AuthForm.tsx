"use client";

import Link from "next/link";
import { useActionState } from "react";
import { logIn, signUp, type FormState } from "../actions/auth";
import Spinner from "./Spinner";

export default function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mode === "login" ? logIn : signUp, {});
  const isSignup = mode === "signup";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{isSignup ? "Create your study space" : "Welcome back"}</h1>
      <p className="mt-1.5 text-sm text-muted">
        {isSignup ? "Free, private, and runs on your own AI." : "Log in to pick up where you left off."}
      </p>

      <form action={action} className="mt-7 space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        {isSignup && (
          <div>
            <label htmlFor="name" className="label">
              Name
            </label>
            <input id="name" name="name" autoComplete="name" required maxLength={60} defaultValue={state.fields?.name} className="field" />
          </div>
        )}
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state.fields?.email}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={isSignup ? 8 : undefined}
            className="field"
          />
          {isSignup && <p className="mt-1.5 text-xs text-faint">At least 8 characters.</p>}
        </div>

        {state.error && (
          <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
          {pending && <Spinner />}
          {isSignup ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {isSignup ? "Already have an account? " : "New here? "}
        <Link href={isSignup ? "/login" : "/signup"} className="font-medium text-accent hover:underline">
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
