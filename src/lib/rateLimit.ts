import "server-only";

/**
 * Small in-memory sliding-window limiter. It protects a single GPU from being
 * monopolised by one client. It is per-process: behind several replicas, put
 * a shared limiter (e.g. at the reverse proxy) in front instead.
 */

const hits = new Map<string, number[]>();
let lastSweep = Date.now();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (max <= 0) return { allowed: true, retryAfterSeconds: 0 }; // disabled

  if (now - lastSweep > windowMs) {
    for (const [k, times] of hits) {
      if (!times.length || now - times[times.length - 1] > windowMs) hits.delete(k);
    }
    lastSweep = now;
  }

  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "anonymous";
}
