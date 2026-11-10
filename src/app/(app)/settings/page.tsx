import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
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
      <Section title="Delete account">
        <DeleteAccountForm />
      </Section>
    </div>
  );
}
