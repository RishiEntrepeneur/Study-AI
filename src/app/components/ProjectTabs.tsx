"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MessagesSquare } from "lucide-react";
import { OUTPUTS } from "@/lib/outputs";
import { useGenerations } from "./GenerationProvider";
import OutputIcon from "./OutputIcon";

export default function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const { get } = useGenerations();
  const base = `/projects/${projectId}`;

  const tabs = [
    { href: base, label: "Overview", icon: <LayoutDashboard className="size-4" />, dot: null as string | null },
    ...OUTPUTS.map((o) => {
      const s = get(o.type);
      const dot = !s ? null : s.status === "queued" || s.status === "running" ? "bg-accent animate-pulse" : s.status === "error" ? "bg-bad" : null;
      return { href: `${base}/${o.path}`, label: o.label, icon: <OutputIcon type={o.type} />, dot, muted: !s || (!s.hasContent && s.status !== "queued" && s.status !== "running") };
    }),
    { href: `${base}/chat`, label: "Ask tutor", icon: <MessagesSquare className="size-4" />, dot: null },
  ];

  return (
    <nav aria-label="Project sections" className="-mx-4 overflow-x-auto px-4 sm:-mx-8 sm:px-8">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => {
          const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${
                  active ? "font-medium text-ink" : "text-muted hover:text-ink"
                } ${"muted" in t && t.muted && !active ? "opacity-60" : ""}`}
              >
                {t.icon}
                {t.label}
                {t.dot && <span className={`size-1.5 rounded-full ${t.dot}`} />}
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
