import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { SimControl } from '@blobocracy/shared';
import type { BudgetGovernor } from './budget';

export interface AdminRequest { method: string; path: string; auth: string; body: string }
export interface AdminResponse { status: number; body: unknown }

/** A bare address or an address/prefix within its family's range. */
export function validCidr(s: string): boolean {
  const [addr, len, extra] = s.trim().split('/');
  const kind = isIP(addr ?? '');
  if (!kind || extra !== undefined) return false;
  if (len === undefined) return true;
  return /^\d+$/.test(len) && Number(len) <= (kind === 4 ? 32 : 128);
}

function tokenOk(want: string, header: string): boolean {
  const got = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const w = Buffer.from(want);
  return got.length === w.length && timingSafeEqual(got, w);
}

/**
 * The admin API (spec §8, §10), served by the sim (internal port) and reachable through any
 * edge at /admin/*. Bearer `ADMIN_TOKEN`; without it the API does not exist.
 *   GET  /admin/stats              world, relays, abuse counters, budget
 *   POST /admin/ban   {cidr}       ban an IP or range on every relay (existing sockets close)
 *   POST /admin/unban {cidr}
 *   POST /admin/budget {monthlyUsd} raise (or lower) the monthly budget live
 *   POST /admin/reset-flags        clear every shadow-ban flag
 *   POST /admin/debug/checkpoint   dev only: {"n": 1..4} put the blob just before that checkpoint's flag
 *   POST /admin/debug/kill         dev only: drop the blob into the pit
 *   POST /admin/debug/win          dev only: put the blob just before the goal (refused when NODE_ENV=production)
 */
export function createAdmin(ctx: {
  token: string | undefined;
  governor: BudgetGovernor;
  stats: () => Record<string, unknown>;
  control: (c: SimControl) => void;
  onBudget: () => void;
  bans?: Set<string>;
  /** Called after the ban list changes (persisted with the live snapshot). */
  onBans?: () => void;
  /** Production refuses the debug actions. */
  production?: boolean;
  /** Puts the blob just before the current level's goal; false when it can't right now (dying, celebrating). */
  debugWin?: () => boolean;
  debugCheckpoint?: (n: number) => boolean;
  debugKill?: () => boolean;
}) {
  const bans = ctx.bans ?? new Set<string>();
  const pushBans = () => ctx.control({ c: 'bans', cidrs: [...bans] });

  return (req: AdminRequest): AdminResponse => {
    if (!ctx.token) return { status: 404, body: { error: 'admin disabled (set ADMIN_TOKEN)' } };
    if (!tokenOk(ctx.token, req.auth ?? '')) return { status: 401, body: { error: 'unauthorized' } };
    let body: Record<string, unknown> = {};
    if (req.body) {
      let parsed: unknown;
      try { parsed = JSON.parse(req.body); } catch { return { status: 400, body: { error: 'bad json' } }; }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { status: 400, body: { error: 'body must be a JSON object' } };
      body = parsed as Record<string, unknown>;
    }
    const route = `${req.method.toUpperCase()} ${req.path.replace(/\/+$/, '')}`;
    switch (route) {
      case 'GET /admin/stats':
        return { status: 200, body: { ...ctx.stats(), bans: [...bans], budget: ctx.governor.snapshot() } };
      case 'POST /admin/ban':
      case 'POST /admin/unban': {
        const cidr = typeof body.cidr === 'string' ? body.cidr.trim() : '';
        if (!validCidr(cidr)) return { status: 400, body: { error: 'cidr must be an IP or CIDR, e.g. 203.0.113.0/24' } };
        if (route.endsWith('/ban')) bans.add(cidr); else bans.delete(cidr);
        pushBans();
        ctx.onBans?.();
        return { status: 200, body: { bans: [...bans] } };
      }
      case 'POST /admin/budget': {
        const usd = Number(body.monthlyUsd);
        if (!(usd > 0) || !Number.isFinite(usd)) return { status: 400, body: { error: 'monthlyUsd must be a positive number' } };
        ctx.governor.setBudget(usd);
        ctx.onBudget();
        return { status: 200, body: { budget: ctx.governor.snapshot() } };
      }
      case 'POST /admin/debug/win': {
        if (ctx.production || !ctx.debugWin) return { status: 403, body: { error: 'debug actions are off in production' } };
        return ctx.debugWin()
          ? { status: 200, body: { ok: true, hint: 'the blob is just before the goal: hold right to win' } }
          : { status: 409, body: { error: 'not now: the blob is dying or already celebrating' } };
      }
      case 'POST /admin/debug/checkpoint':
      case 'POST /admin/debug/kill': {
        if (ctx.production || !ctx.debugCheckpoint || !ctx.debugKill) return { status: 403, body: { error: 'debug actions are off in production' } };
        const ok = route.endsWith('/kill') ? ctx.debugKill() : ctx.debugCheckpoint(Math.trunc(Number(body.n)));
        return ok ? { status: 200, body: { ok: true } } : { status: 409, body: { error: 'not now (dying or celebrating) or no such checkpoint' } };
      }
      case 'POST /admin/reset-flags':
        ctx.control({ c: 'resetFlags' });
        return { status: 200, body: { ok: true } };
      default:
        return { status: 404, body: { error: 'not found' } };
    }
  };
}
