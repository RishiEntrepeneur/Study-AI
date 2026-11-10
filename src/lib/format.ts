/** Small formatting helpers shared by server and client components. */

export function timeAgo(date: Date | number, now = Date.now()): string {
  const ms = now - (typeof date === "number" ? date : date.getTime());
  const s = Math.round(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: d > 300 ? "numeric" : undefined });
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
