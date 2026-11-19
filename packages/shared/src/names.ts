// Player names: chosen when you join, shown to everyone on the crowd dots. Validation runs on
// the relay (never trust a client) and again before anything is drawn. A name is plain text:
// letters, numbers, spaces and _ - . only, up to MAX_NAME_LEN characters, no links, no
// profanity, and nothing that poses as the game or its staff.

export const MAX_NAME_LEN = 16;

/** Control, format (zero-width, direction marks), surrogate, private-use and unassigned characters. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu;
const NOT_ALLOWED = /[^\p{L}\p{N}\p{M}_.\- ]/gu;

/** Look-alike digits and symbols folded to letters before matching words. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's', '@': 'a', '!': 'i', '|': 'i', '€': 'e', '£': 'l' };

/** Bad whenever they appear anywhere in the name (letters only, spaces and punctuation removed): none of these occur inside ordinary words or names. */
const BAD_ANYWHERE = [
  'fuck', 'shit', 'bitch', 'nigg', 'whore', 'retard', 'hitler', 'paedo', 'molest', 'blowjob', 'handjob', 'cumshot', 'jizz', 'dildo',
  'faggot', 'tranny', 'wetback', 'beaner', 'raghead', 'towelhead', 'killyourself',
];
/** Bad only as a whole word: they sit inside innocent words (Scunthorpe, Classic, Dickens, grape). */
const BAD_WORDS = new Set([
  'ass', 'arse', 'asshole', 'dick', 'cock', 'pussy', 'tit', 'tits', 'boob', 'boobs', 'fag', 'fags', 'rape', 'rapist', 'cum', 'sex', 'porn', 'nazi', 'spic', 'slut', 'twat', 'wank', 'piss', 'damn',
  'fck', 'fuk', 'fuq', 'sht', 'btch', 'cnt', 'dck', 'nig', 'nga',
  'cunt', 'cunts', 'kys', 'coon', 'kike', 'chink', 'gook', 'pedo', 'penis', 'vagina', 'anal',
]);
/** Names that pose as the game or its staff (compared with digits and punctuation removed). */
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'staff', 'blobocracy', 'you', 'system', 'server', 'official', 'support', 'owner', 'dev', 'developer']);

const TLDS = 'com|net|org|io|gg|me|co|tv|xyz|ly|app|dev|info|biz|ru|cn|uk|de|fr|us|ca|au|link|site|online|shop|store|top|cc|to|fm|gl';
const LINK = new RegExp(`(https?|ftp)|www|[a-z0-9]\\.(${TLDS})(\\b|$)`, 'i');

/** Folds a name down for matching: lower-case, look-alikes to letters, nothing but letters. */
function fold(s: string, keepSpaces: boolean): string {
  let out = '';
  for (const ch of s.toLowerCase()) out += LEET[ch] ?? ch;
  return out.replace(keepSpaces ? /[^\p{L} ]/gu : /[^\p{L}]/gu, keepSpaces ? '' : '');
}

function isBad(name: string, extra: readonly string[]): boolean {
  if (LINK.test(name)) return true;
  const squashed = fold(name, false);
  if (BAD_ANYWHERE.some((w) => squashed.includes(w))) return true;
  if (extra.some((w) => w && squashed.includes(fold(w, false)))) return true;
  const words = fold(name.replace(/[._-]+/g, ' '), true).split(' ').filter(Boolean);
  if (words.some((w) => BAD_WORDS.has(w))) return true;
  // single letters spaced out ("f u c k") or dotted ("F.U.C.K") squash to a word: test the joined letters of short pieces
  const joined = words.length > 1 && words.every((w) => w.length <= 2) ? words.join('') : '';
  if (joined && (BAD_ANYWHERE.some((w) => joined.includes(w)) || BAD_WORDS.has(joined))) return true;
  const letters = squashed;
  return RESERVED.has(letters);
}

/**
 * The name as it will be shown, or null when it is not acceptable. `extraBlocked` adds
 * deployment-specific words (the NAME_BLOCKLIST setting).
 */
export function cleanName(raw: unknown, extraBlocked: readonly string[] = []): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFKC').replace(INVISIBLE, '').replace(NOT_ALLOWED, '').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return null;
  if (isBad(s, extraBlocked)) return null;
  s = [...s].slice(0, MAX_NAME_LEN).join('').trim();
  if (!/[\p{L}\p{N}]/u.test(s) || isBad(s, extraBlocked)) return null;
  return s;
}

const ADJECTIVES = [
  'Sleepy', 'Brave', 'Wobbly', 'Soggy', 'Sneaky', 'Grumpy', 'Jolly', 'Fuzzy', 'Zesty', 'Bouncy', 'Cosmic', 'Dizzy', 'Fancy', 'Gentle', 'Hasty', 'Lucky',
  'Mighty', 'Nimble', 'Plucky', 'Quirky', 'Rowdy', 'Silly', 'Tiny', 'Witty', 'Chilly', 'Dapper', 'Eager', 'Feisty', 'Giddy', 'Humble', 'Jazzy', 'Keen',
];
const NOUNS = [
  'Waffle', 'Turnip', 'Noodle', 'Pickle', 'Muffin', 'Walrus', 'Biscuit', 'Pebble', 'Otter', 'Pretzel', 'Badger', 'Cactus', 'Donut', 'Falcon', 'Goblin', 'Hamster',
  'Igloo', 'Jelly', 'Koala', 'Lemur', 'Mango', 'Nugget', 'Octopus', 'Panda', 'Quokka', 'Radish', 'Sloth', 'Taco', 'Walnut', 'Yeti', 'Zebra', 'Bagel',
];

/** A friendly default name ("Sleepy Waffle") from a random source in [0, 1). */
export function randomName(rng: () => number): string {
  const pick = <T>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

/** What a player may send to set their name (text on their socket). */
export interface NameMessage { c: 'name'; name: string }
/** Most a name message may weigh: a name is at most 16 characters, so this leaves room for escapes. */
export const MAX_NAME_MESSAGE_BYTES = 256;

/** Parses a text message from a player as a name message; null for anything else. */
export function parseNameMessage(text: string): NameMessage | null {
  if (text.length > MAX_NAME_MESSAGE_BYTES || !text.startsWith('{"c":"name"')) return null;
  try {
    const m = JSON.parse(text) as { c?: unknown; name?: unknown };
    return m.c === 'name' && typeof m.name === 'string' ? { c: 'name', name: m.name } : null;
  } catch {
    return null;
  }
}

/** At most `max` name changes per `windowMs` per player (default 4 per 30 s). */
export class NameChangeLimiter {
  private at: number[] = [];
  constructor(private readonly max = 4, private readonly windowMs = 30_000) {}
  allow(nowMs: number): boolean {
    this.at = this.at.filter((t) => nowMs - t < this.windowMs);
    if (this.at.length >= this.max) return false;
    this.at.push(nowMs);
    return true;
  }
}
