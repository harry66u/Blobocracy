import { describe, expect, test } from 'vitest';
import { MAX_NAME_LEN, cleanName, randomName } from '../src/names';

describe('cleanName', () => {
  test('keeps an ordinary name, trimmed and with single spaces', () => {
    expect(cleanName('  Sleepy   Waffle ')).toBe('Sleepy Waffle');
    expect(cleanName('Ana_99')).toBe('Ana_99');
    expect(cleanName('José')).toBe('José');
    expect(cleanName('日本語')).toBe('日本語');
  });

  test('rejects empty, too short after cleaning, and anything not text', () => {
    expect(cleanName('')).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('​​')).toBeNull();
    expect(cleanName(undefined as unknown as string)).toBeNull();
    expect(cleanName(42 as unknown as string)).toBeNull();
  });

  test('cuts to the length limit by characters, not bytes', () => {
    expect(cleanName('a'.repeat(40))).toBe('a'.repeat(MAX_NAME_LEN));
    expect([...cleanName('é'.repeat(40))!].length).toBe(MAX_NAME_LEN);
  });

  test('strips control, zero-width and direction-changing characters', () => {
    expect(cleanName('Bl​ob‮')).toBe('Blob');
    expect(cleanName('a\u0000b\nc')).toBe('abc');
  });

  test('drops symbols and markup, keeping letters, numbers, space and _ - .', () => {
    expect(cleanName('<b>Bob</b>')).toBe('bBobb');
    expect(cleanName('Blo*b$')).toBe('Blob');
    expect(cleanName('ok_name-1.2')).toBe('ok_name-1.2');
  });

  test('refuses links and handles', () => {
    expect(cleanName('visit www.example.com')).toBeNull();
    expect(cleanName('http://x')).toBeNull();
    expect(cleanName('free-stuff.com')).toBeNull();
    expect(cleanName('@someone')).toBe('someone');
  });

  test('refuses profanity, including spaced-out and look-alike spellings', () => {
    expect(cleanName('shit')).toBeNull();
    expect(cleanName('Sh1t head')).toBeNull();
    expect(cleanName('f u c k')).toBeNull();
    expect(cleanName('F.U.C.K')).toBeNull();
    expect(cleanName('n1gger')).toBeNull();
  });

  test('does not refuse innocent names that contain a bad word inside (the Scunthorpe problem)', () => {
    expect(cleanName('Scunthorpe')).toBe('Scunthorpe');
    expect(cleanName('Cassandra')).toBe('Cassandra');
    expect(cleanName('Classic')).toBe('Classic');
    expect(cleanName('Dickens')).toBe('Dickens');
  });

  test('refuses impersonation of the game itself', () => {
    expect(cleanName('Admin')).toBeNull();
    expect(cleanName('Moderator')).toBeNull();
    expect(cleanName('Blobocracy')).toBeNull();
    expect(cleanName('you')).toBeNull();
  });

  test('extra blocked words can be supplied', () => {
    expect(cleanName('Flarb', ['flarb'])).toBeNull();
    expect(cleanName('Flarb')).toBe('Flarb');
  });
});

describe('randomName', () => {
  test('is always a valid name and varies', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const n = randomName(() => Math.random());
      expect(cleanName(n), n).toBe(n);
      seen.add(n);
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  test('every one of the combinations is a clean, valid name', () => {
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 32; j++) {
        const seq = [(i + 0.5) / 32, (j + 0.5) / 32];
        let k = 0;
        const n = randomName(() => seq[k++]!);
        expect(cleanName(n), n).toBe(n);
      }
    }
  });

  test('is deterministic for a given random source', () => {
    let s = 7;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    let t = 7;
    const rng2 = () => { t = (t * 16807) % 2147483647; return t / 2147483647; };
    expect(randomName(rng)).toBe(randomName(rng2));
  });
});
