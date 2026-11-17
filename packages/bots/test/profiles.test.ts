import { describe, expect, test } from 'vitest';
import { FARM_SIZE, planBots } from '../src/profiles';

describe('bot plans', () => {
  test('a single profile gives every bot that profile and its own IP', () => {
    const plan = planBots(100, 'random');
    expect(plan.every((b) => b.profile === 'random')).toBe(true);
    expect(new Set(plan.map((b) => b.ip)).size).toBe(100);
  });

  test('mixed is mostly well-behaved, with every abusive profile present', () => {
    const plan = planBots(5000, 'mixed');
    const n = (p: string) => plan.filter((b) => b.profile === p).length;
    expect(plan.length).toBe(5000);
    expect(n('follower')).toBeGreaterThan(3000);
    for (const p of ['random', 'idle', 'spammer', 'farm', 'perfect-timing']) expect(n(p)).toBeGreaterThan(0);
  });

  test('farm bots come in groups of 40 sharing one IP and one script', () => {
    const farm = planBots(120, 'farm');
    const byIp = new Map<string, number>();
    for (const b of farm) byIp.set(b.ip, (byIp.get(b.ip) ?? 0) + 1);
    expect([...byIp.values()]).toEqual([FARM_SIZE, FARM_SIZE, FARM_SIZE]);
    expect(new Set(farm.map((b) => b.group)).size).toBe(3);
  });

  test('bots are spread across the given URLs round-robin', () => {
    const plan = planBots(4, 'idle', ['ws://a/ws', 'ws://b/ws']);
    expect(plan.map((b) => b.url)).toEqual(['ws://a/ws', 'ws://b/ws', 'ws://a/ws', 'ws://b/ws']);
  });
});
