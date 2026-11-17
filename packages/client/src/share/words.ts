// Words for a death: shared by the death card, the share image, the clip and the text line.
import type { PersonalStats } from '../stats.ts';

/** Everything a share needs about one death, captured when it happens. */
export interface DeathShare {
  /** The global death number (this death included). */
  death: number;
  run: number;
  progress: number;
  cause: string;
  zoneIndex: number;
  zoneName: string;
  /** Most people online at once during the run, and most steering at once. */
  peak: number;
  peakActive: number;
  secs: number;
  nearRecord: boolean;
  /** Whether this browser pressed something during the run. */
  wasPart: boolean;
  /** Personal stats after this death was counted. */
  stats: PersonalStats;
}

const CAUSE_NAMES: Record<string, string> = {
  spikes: 'Spikes', 'ceiling spikes': 'Ceiling Spikes', pit: 'Pit',
  press: 'Big Press', crumble: 'Crumble', saw: 'Saw', chomp: 'Big Chomp',
};

/** "the Spikes", "the Pit", "the Big Chomp". */
export function causeName(cause: string): string {
  return CAUSE_NAMES[cause] ?? cause.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const pct = (p: number) => `${Math.max(0, Math.min(100, Math.floor(p * 100)))}%`;

/** "312 people steering", "1 person steering", or players online when nobody steered. */
export function crowdPhrase(d: Pick<DeathShare, 'peak' | 'peakActive'>): string {
  const n = Math.max(d.peakActive, 1);
  return n === 1 ? '1 person steering' : `${fmt(n)} people steering`;
}

/** "57 deaths · best run 63% · 4 days" for this browser, or null before your first death. */
export function statsLine(s: PersonalStats): string | null {
  if (s.deaths === 0 && s.days === 0) return null;
  const parts = [`${fmt(s.deaths)} ${s.deaths === 1 ? 'death' : 'deaths'}`];
  if (s.best) parts.push(`best run ${pct(s.best.progress)}`);
  parts.push(`${fmt(Math.max(1, s.days))} ${s.days === 1 ? 'day' : 'days'}`);
  return parts.join(' · ');
}

/** Absolute link carried by shared text. */
export function shareUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/?via=share`;
}

/** Bare domain for images and clips, e.g. "blobocracy.com". */
export function siteHost(siteUrl: string): string {
  try { return new URL(siteUrl).host.replace(/^www\./, ''); } catch { return siteUrl; }
}

/**
 * The plain text line for group chats. Short, no hashtags, no emoji, one link:
 * "Blobocracy death #1,234: 312 people steering got the blob 41% of the way before the Spikes got it.
 *  I've been there for 57 deaths. https://…/?via=share"
 */
export function shareText(d: DeathShare, siteUrl: string): string {
  const lead = d.nearRecord ? 'So close. ' : '';
  const how = `${crowdPhrase(d)} got the blob ${pct(d.progress)} of the way, then the ${causeName(d.cause)} got it.`;
  const me = d.stats.deaths > 0 ? ` I've been there for ${fmt(d.stats.deaths)} ${d.stats.deaths === 1 ? 'death' : 'deaths'}.` : '';
  return `${lead}Blobocracy death #${fmt(d.death)}: ${how}${me} ${shareUrl(siteUrl)}`;
}
