import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { activeContextSize, getAIConfig } from "@/lib/ai/config";
import ThemeToggle from "../../components/ThemeToggle";
import { AIStatus, DeleteAccountForm, PasswordForm, ProfileForm } from "../../components/SettingsForms";

export const metadata: Metadata = { title: "Settings" };

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const MODE_TEXT = {
  light: "Light mode, made for laptops with about 8 GB of memory",
  balanced: "Balanced mode",
  roomy: "Roomy mode, for computers with plenty of memory",
  custom: "Custom setting from .env.local",
} as const;

function AISpeed() {
  const cfg = getAIConfig();
  const context = activeContextSize(cfg);
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">Memory setting</dt>
        <dd>
          {MODE_TEXT[cfg.memory.mode]}
          {cfg.memory.localAI && cfg.memory.mode !== "custom" && <span className="text-muted"> (this computer has {cfg.memory.totalGb} GB)</span>}
        </dd>
        <dt className="text-muted">AI working memory</dt>
        <dd>
          {context.toLocaleString()} tokens{context < cfg.contextSize && <span className="text-muted"> (lowered after running out of memory)</span>}
        </dd>
        <dt className="text-muted">Unloads the model after</dt>
        <dd>{cfg.keepAlive} without use</dd>
      </dl>
      <p className="text-muted">
        Still slow? Pick fewer things to make at once (notes and flashcards are a good start), keep the Standard depth, and close other big programs
        while the AI writes. A smaller model, such as <span className="font-mono">qwen3.5:2b</span>, is faster still (see the README).
      </p>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 mb-6 text-muted">{user.email}</p>
      <Section title="Profile">
        <ProfileForm name={user.name} />
      </Section>
      <Section title="Password" description="Changing it signs you out on other devices.">
        <PasswordForm />
      </Section>
      <Section title="Appearance">
        <ThemeToggle showLabels />
      </Section>
      <Section title="AI server" description="Your private AI. Nothing you study is sent anywhere else.">
        <AIStatus />
      </Section>
      <Section title="AI speed" description="Picked automatically to suit this computer.">
        <AISpeed />
      </Section>
      <Section title="Delete account">
        <DeleteAccountForm />
      </Section>
    </div>
  );
}
