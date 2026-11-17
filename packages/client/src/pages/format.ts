// Small, pure formatting helpers for the history pages (tested in test/pages.test.ts).
import { causeName } from '@blobocracy/shared';

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** "2:14", "1:02:09", "0:04". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (v: number) => String(v).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", then a date. */
export function relTime(at: number, now: number): string {
  const s = Math.round((now - at) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** "November 17, 2026". */
export const longDate = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** What ended a run, as a name: "Big Press", "Pit", or "The finish!" for a win. */
export function killerName(cause: string): string {
  return cause === 'win' ? 'The finish!' : causeName(cause);
}

/** Pages to offer around the current one: 1 … 4 5 [6] 7 8 … 80. `null` is a gap. */
export function pageList(page: number, pages: number, around = 1): (number | null)[] {
  const want = new Set<number>([1, pages]);
  for (let p = page - around; p <= page + around; p++) if (p >= 1 && p <= pages) want.add(p);
  const sorted = [...want].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push(p - sorted[i - 1]! === 2 ? p - 1 : null);
    out.push(p);
  });
  return out;
}

/** Digits and separators of a number for the flip cards: "4,812" → ['4', ',', '8', '1', '2']. */
export const flipChars = (n: number) => [...fmt(n)];
