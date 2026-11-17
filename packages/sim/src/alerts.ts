// Alerts to a Discord or Slack webhook (ALERT_WEBHOOK_URL). The body carries both
// `content` (Discord) and `text` (Slack), so either kind of incoming webhook accepts it.
// Without a webhook, alerts go to the server log only.

export type AlertFn = (text: string) => void;

export function makeAlerter(url: string | undefined, log: (s: string) => void = console.log, doFetch: typeof fetch = fetch): AlertFn & { sent: string[]; flush(): Promise<void> } {
  const sent: string[] = [];
  const pending = new Set<Promise<void>>();
  const fn = ((text: string) => {
    sent.push(text);
    log(`[alert] ${text}`);
    if (!url) return;
    const p = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text }) });
          if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) return;
        } catch { /* retry */ }
        await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      }
      log('[alert] webhook failed after 3 tries');
    })();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }) as AlertFn & { sent: string[]; flush(): Promise<void> };
  fn.sent = sent;
  fn.flush = async () => { await Promise.all([...pending]); };
  return fn;
}

/** Wraps an alerter so the same kind of alert fires at most once per `everyMs`. */
export function throttled(alert: AlertFn, everyMs: number): (key: string, text: string, nowMs: number) => void {
  const last = new Map<string, number>();
  return (key, text, nowMs) => {
    const t = last.get(key);
    if (t !== undefined && nowMs - t < everyMs) return;
    last.set(key, nowMs);
    alert(text);
  };
}
