"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function ThemeToggle({ showLabels = false }: { showLabels?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    // Sync with what the pre-paint script applied.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setTheme(readTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => readTheme() === "system" && apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const choose = (value: Theme) => {
    setTheme(value);
    try {
      if (value === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", value);
    } catch {
      /* storage blocked: still apply for this visit */
    }
    apply(value);
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-line bg-subtle p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={`inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs transition-colors ${
            theme === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          <Icon className="size-3.5" />
          {showLabels && label}
        </button>
      ))}
    </div>
  );
}
