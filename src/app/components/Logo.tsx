import Link from "next/link";

/** Wordmark: an index card with a highlighter stroke. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="3" y="6" width="26" height="20" rx="3" className="fill-surface stroke-line" strokeWidth="1.5" />
      <line x1="3.5" y1="11.5" x2="28.5" y2="11.5" stroke="rgb(220 60 70)" strokeOpacity="0.6" strokeWidth="1.2" />
      <rect x="8" y="15" width="16" height="5" rx="1.5" className="fill-mark" />
      <line x1="8" y1="17.5" x2="20" y2="17.5" className="stroke-accent" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-md text-ink">
      <LogoMark />
      {!compact && (
        <span className="text-[15px] leading-tight font-semibold tracking-tight">
          Superpower <span className="font-normal text-muted">Study Suite</span>
        </span>
      )}
    </Link>
  );
}
