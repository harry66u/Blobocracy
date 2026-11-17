/**
 * Bot crowd profiles (spec §11). Well-behaved: `follower` (plays like a person: pushes on,
 * jumps at what is coming with a human reaction delay, sometimes disagrees), `random`, `idle`.
 * Abusive, to prove each defense in §8 fires: `spammer` (input flood → rate limit),
 * `farm` (40 sockets from one IP replaying one script → connection cap, influence cap,
 * identical-stream check), `perfect-timing` (a metronome → regular-timing check).
 */
export const PROFILES = ['follower', 'random', 'idle', 'spammer', 'farm', 'perfect-timing'] as const;
export type Profile = (typeof PROFILES)[number];
export type ProfileArg = Profile | 'mixed';

/** Sockets per farm IP: more than the per-IP connection cap (32), so the cap visibly bites. */
export const FARM_SIZE = 40;

export interface BotSpec { index: number; profile: Profile; ip: string; url: string; group: number }

const MIX: [Profile, number][] = [
  ['follower', 0.7], ['random', 0.1], ['idle', 0.1], ['spammer', 0.03], ['farm', 0.04], ['perfect-timing', 0.03],
];

/** Distinct fake client IPs (sent in x-test-ip; edges honor it only with TRUST_TEST_IP_HEADER=1). */
const ipFor = (n: number) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;

export function planBots(count: number, profile: ProfileArg, urls: string[] = ['ws://localhost:8080/ws'], ipBase = 1): BotSpec[] {
  const kinds: Profile[] = [];
  if (profile === 'mixed') {
    for (const [p, share] of MIX) for (let i = 0; i < Math.round(count * share); i++) kinds.push(p);
    while (kinds.length < count) kinds.push('follower');
    kinds.length = count;
    // Shuffle (seeded) so every URL and every moment of the ramp sees every profile.
    let seed = 12345;
    for (let i = kinds.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
    }
  } else {
    for (let i = 0; i < count; i++) kinds.push(profile);
  }
  const out: BotSpec[] = [];
  let farmIndex = 0;
  kinds.forEach((p, i) => {
    let ip = ipFor(ipBase + i), group = -1, url = urls[i % urls.length]!;
    if (p === 'farm') {
      // One farm = one machine behind one IP, hitting one relay (caps are per relay until Redis, §9).
      group = Math.floor(farmIndex++ / FARM_SIZE);
      ip = `10.250.${(group >> 8) & 255}.${group & 255}`;
      url = urls[group % urls.length]!;
    }
    out.push({ index: i, profile: p, ip, url, group });
  });
  return out;
}
