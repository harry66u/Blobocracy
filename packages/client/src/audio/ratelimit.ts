// Per-key minimum spacing for repeated sound effects (times in seconds).
export class RateLimiter {
  private last = new Map<string, number>();
  constructor(private intervals: Record<string, number>, private fallback = 0.05) {}

  /** True (and records the time) if `key` may play at `now`; refused calls change nothing. */
  allow(key: string, now: number): boolean {
    const prev = this.last.get(key);
    const gap = this.intervals[key] ?? this.fallback;
    if (prev !== undefined && now - prev < gap) return false;
    this.last.set(key, now);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}
