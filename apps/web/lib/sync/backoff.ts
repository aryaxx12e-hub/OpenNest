export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
  random?: () => number;
}

const DEFAULTS = {
  baseMs: 1000,
  maxMs: 30_000,
  jitterRatio: 0.2,
};

export function nextRetryDelay(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = Math.max(1, options.baseMs ?? DEFAULTS.baseMs);
  const maxMs = Math.max(baseMs, options.maxMs ?? DEFAULTS.maxMs);
  const jitterRatio = Math.min(
    1,
    Math.max(0, options.jitterRatio ?? DEFAULTS.jitterRatio)
  );
  const random = options.random ?? Math.random;
  const exponent = Math.min(30, Math.max(0, Math.trunc(attempt)));
  const raw = Math.min(maxMs, baseMs * 2 ** exponent);
  const spread = raw * jitterRatio;
  const low = Math.max(0, raw - spread);
  const high = Math.min(maxMs, raw + spread);
  const delay = Math.round(low + random() * (high - low));

  return Math.min(maxMs, Math.max(0, delay));
}
