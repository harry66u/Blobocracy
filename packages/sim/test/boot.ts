import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Boots an entry point; resolves with its exit code (null: it came up and was stopped) and output. */
export function boot(entry: string, env: Record<string, string>, ready: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const base = { ...process.env };
    for (const k of ['NODE_ENV', 'RELAY_SECRET', 'DATABASE_URL', 'REDIS_URL', 'ALLOW_MEMORY_STORE', 'SESSION_SECRET', 'VIRTUAL_PLAYERS', 'SEED_DEMO_RUNS']) delete base[k];
    const p = spawn(process.execPath, ['--import', 'tsx', entry], { cwd: ROOT, env: { ...base, ...env } });
    let out = '';
    const t = setTimeout(() => p.kill('SIGKILL'), 20_000);
    const onData = (d: Buffer) => { out += d.toString(); if (out.includes(ready)) p.kill('SIGTERM'); };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code: out.includes(ready) ? null : code, out }); });
  });
}
