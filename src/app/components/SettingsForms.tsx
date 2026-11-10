"use client";

import { useActionState, useState } from "react";
import { changePassword, deleteAccount, updateProfile, type FormState } from "../actions/auth";
import { useHealth } from "./StatusPill";
import Spinner from "./Spinner";

function Message({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="text-sm text-bad">{state.error}</p>;
  if (state.success) return <p role="status" className="text-sm text-good">{state.success}</p>;
  return null;
}

export function ProfileForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="name" className="label">Name</label>
        <input id="name" name="name" defaultValue={name} maxLength={60} required className="field max-w-sm" />
      </div>
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending && <Spinner />} Save name
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="space-y-3" key={state.success ? "done" : "form"}>
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="current" className="label">Current password</label>
          <input id="current" name="current" type="password" autoComplete="current-password" required className="field" />
        </div>
        <div>
          <label htmlFor="next" className="label">New password</label>
          <input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required className="field" />
        </div>
      </div>
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending && <Spinner />} Change password
      </button>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteAccount, {});
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className="btn btn-danger">
        Delete my account…
      </button>
    );
  }
  return (
    <form action={action} className="max-w-sm space-y-3 rounded-lg border border-bad/30 bg-bad-soft p-4">
      <p className="text-sm">This permanently deletes your account, folders, projects and study history.</p>
      <div>
        <label htmlFor="confirm-password" className="label">Enter your password to confirm</label>
        <input id="confirm-password" name="password" type="password" autoComplete="current-password" required className="field" />
      </div>
      <Message state={state} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setArmed(false)} className="btn btn-ghost">Cancel</button>
        <button type="submit" disabled={pending} className="btn btn-danger">
          {pending && <Spinner />} Delete permanently
        </button>
      </div>
    </form>
  );
}

export function AIStatus() {
  const health = useHealth(10_000);
  const rows: Array<[string, string]> = [
    ["Status", { checking: "Checking…", online: "Ready", offline: "Not reachable", model_missing: "Model not installed", misconfigured: "Misconfigured" }[health.status]],
    ["Model", health.model ?? "—"],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid max-w-md grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {health.status === "offline" && (
        <p className="max-w-xl text-sm text-muted">
          Start Ollama on the computer that runs the AI (open the Ollama app, or run <code className="rounded bg-subtle px-1">ollama serve</code>), then wait a few seconds.
        </p>
      )}
      {health.status === "model_missing" && (
        <div className="max-w-xl space-y-1 text-sm text-muted">
          <p>
            The app is set to use <strong className="text-ink">{health.model}</strong>, but it isn&apos;t installed. Either run{" "}
            <code className="rounded bg-subtle px-1">ollama pull {health.model}</code>
            {health.installedModels?.length ? (
              <>
                , or set <code className="rounded bg-subtle px-1">AI_MODEL_NAME={health.installedModels[0]}</code> in <code className="rounded bg-subtle px-1">.env.local</code> and restart the app.
              </>
            ) : (
              "."
            )}
          </p>
          {health.installedModels && health.installedModels.length > 0 && <p>Installed models: {health.installedModels.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
