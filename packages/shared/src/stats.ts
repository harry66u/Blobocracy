/** Keeps the last `size` samples and answers percentiles (load-test and admin diagnostics). */
export class Reservoir {
  private buf: Float64Array;
  private n = 0;
  constructor(size = 4096) { this.buf = new Float64Array(size); }
  add(v: number): void {
    if (!Number.isFinite(v)) return;
    this.buf[this.n % this.buf.length] = v;
    this.n++;
  }
  get count(): number { return this.n; }
  percentile(p: number): number | null {
    const k = Math.min(this.n, this.buf.length);
    if (k === 0) return null;
    const sorted = Array.from(this.buf.subarray(0, k)).sort((a, b) => a - b);
    return sorted[Math.min(k - 1, Math.max(0, Math.ceil((p / 100) * k) - 1))]!;
  }
  summary(): { n: number; p50: number | null; p90: number | null; p99: number | null; max: number | null } {
    return { n: this.n, p50: this.percentile(50), p90: this.percentile(90), p99: this.percentile(99), max: this.percentile(100) };
  }
}
