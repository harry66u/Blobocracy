// The share button and panel. After each death a "Share death #N" button sits under the
// death card for a while. On phones one tap opens the system share sheet with the image and
// the text line (the image is pre-rendered so the tap never loses the browser's permission
// to share). The panel holds the other formats: the vertical clip and the plain text line.
import { TICK_HZ, type Level, type ServerEvent, type StateFrame } from '@blobocracy/shared';
import type { SceneLevel } from '../render/scene.ts';
import { renderShareImage } from './card.ts';
import { CLIP_AFTER_S, CLIP_BEFORE_S, type FrameRecorder, type ReplayHud } from './replay.ts';
import { causeName, fmt, shareText, shareUrl, siteHost, statsLine, type DeathShare } from './words.ts';
import type { PersonalStats } from '../stats.ts';
import type { Clip } from './clip.ts';

type DeathEvent = Extract<ServerEvent, { t: 'death' }>;
export type ShareKind = 'image' | 'clip' | 'text';

const PILL_S = 25;
const WAIT_DEATH_FRAME_MS = 1500;

const STYLE = `
.bl-share{position:fixed;z-index:20;font-family:'Atkinson Hyperlegible Next',system-ui,sans-serif;color:#2A1B3D;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.bl-share-bar{left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;transition:opacity .25s,transform .25s}
.bl-share-bar[hidden]{display:none}
.bl-share button{font:inherit;font-weight:800;color:#2A1B3D;background:#FFF1D6;border:3px solid #2A1B3D;border-radius:999px;box-shadow:0 4px 0 #2A1B3D;cursor:pointer;-webkit-tap-highlight-color:transparent}
.bl-share button:active{transform:translateY(3px);box-shadow:0 1px 0 #2A1B3D}
.bl-share button:focus-visible{outline:3px solid #FFD21F;outline-offset:3px}
.bl-share-main{padding:11px 20px 11px 16px;font-size:17px;display:flex;align-items:center;gap:8px;background:#FFD21F!important}
.bl-share-main svg,.bl-share-more svg{width:20px;height:20px;display:block}
.bl-share-more{width:48px;height:48px;padding:0;display:flex;align-items:center;justify-content:center}
.bl-share-scrim{inset:0;background:rgba(42,27,61,.55);display:flex;align-items:flex-end;justify-content:center}
.bl-share-scrim[hidden]{display:none}
.bl-share-panel{background:#FFF1D6;border:3px solid #2A1B3D;border-radius:24px 24px 0 0;box-shadow:0 -4px 0 #2A1B3D;width:100%;max-width:480px;max-height:92dvh;overflow:auto;padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-sizing:border-box}
@media (min-width:700px){.bl-share-scrim{align-items:center}.bl-share-panel{border-radius:24px;box-shadow:0 6px 0 #2A1B3D}}
.bl-share-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.bl-share-head h2{margin:0;font:400 24px 'Bagel Fat One',system-ui,sans-serif}
.bl-share-x{width:40px;height:40px;padding:0;font-size:20px!important;box-shadow:0 3px 0 #2A1B3D!important}
.bl-share-img{display:block;width:100%;max-width:300px;margin:0 auto 12px;border:3px solid #2A1B3D;border-radius:16px;aspect-ratio:4/5;object-fit:cover;background:#5FBFFF}
.bl-share-me{text-align:center;font-weight:700;font-size:15px;margin:0 0 14px;color:rgba(42,27,61,.8)}
.bl-share-row{display:grid;grid-template-columns:1fr;gap:10px}
.bl-share-row button{padding:13px 16px;font-size:17px;border-radius:16px;text-align:left;display:flex;justify-content:space-between;align-items:center}
.bl-share-row button small{font-weight:600;font-size:13px;opacity:.75}
.bl-share-row button[disabled]{opacity:.6;cursor:progress}
.bl-share-text{margin:12px 0 0;width:100%;box-sizing:border-box;font:600 14px/1.4 inherit;font-family:inherit;color:#2A1B3D;background:#FFFBF1;border:2px solid rgba(42,27,61,.35);border-radius:12px;padding:10px;resize:none}
.bl-share-note{font-size:12px;opacity:.7;margin:10px 0 0;text-align:center}
`;

const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2.4"/><circle cx="12" cy="12" r="2.4"/><circle cx="19" cy="12" r="2.4"/></svg>';

interface Pending {
  share: DeathShare;
  hud: ReplayHud | null;
  deathTick: number | null;
  frames: StateFrame[] | null;
  image: { blob: Blob; url: string } | null;
  imageP: Promise<void> | null;
  clip: Clip | null;
  clipP: Promise<Clip> | null;
}

export interface ShareDeps {
  level: Level;
  sceneLevel: SceneLevel;
  recorder: FrameRecorder;
  siteUrl: string;
  onShare?: (kind: ShareKind, how: 'sheet' | 'download' | 'copy') => void;
  /** Called when the share UI takes focus, so held game keys get released. */
  onOpen?: () => void;
}

const canShareFiles = (f: File) => typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function copyText(text: string, fallbackEl: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallbackEl.focus();
    fallbackEl.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

export class ShareUI {
  private readonly bar: HTMLDivElement;
  private readonly mainBtn: HTMLButtonElement;
  private readonly scrim: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly me: HTMLParagraphElement;
  private readonly imgBtn: HTMLButtonElement;
  private readonly clipBtn: HTMLButtonElement;
  private readonly textBtn: HTMLButtonElement;
  private readonly textEl: HTMLTextAreaElement;
  private readonly note: HTMLParagraphElement;
  private p: Pending | null = null;
  private shownAt = 0;
  private lastFocus: Element | null = null;
  private readonly host: string;

  constructor(private readonly deps: ShareDeps, root: HTMLElement = document.body) {
    this.host = siteHost(deps.siteUrl);
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    this.bar = document.createElement('div');
    this.bar.className = 'bl-share bl-share-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = `<button type="button" class="bl-share-main">${ICON_SHARE}<span></span></button>`
      + `<button type="button" class="bl-share-more" aria-label="More ways to share: clip or text">${ICON_MORE}</button>`;
    this.mainBtn = this.bar.querySelector('.bl-share-main')!;
    this.mainBtn.addEventListener('click', () => void this.oneTap());
    this.bar.querySelector('.bl-share-more')!.addEventListener('click', () => this.open());
    root.appendChild(this.bar);

    this.scrim = document.createElement('div');
    this.scrim.className = 'bl-share bl-share-scrim';
    this.scrim.hidden = true;
    this.scrim.innerHTML = `<div class="bl-share-panel" role="dialog" aria-modal="true" aria-labelledby="bl-share-title">
      <div class="bl-share-head"><h2 id="bl-share-title">Share this death</h2><button type="button" class="bl-share-x" aria-label="Close">✕</button></div>
      <img class="bl-share-img" alt="">
      <p class="bl-share-me"></p>
      <div class="bl-share-row">
        <button type="button" data-k="image"></button>
        <button type="button" data-k="clip"></button>
        <button type="button" data-k="text"></button>
      </div>
      <textarea class="bl-share-text" rows="3" readonly aria-label="Text to paste"></textarea>
      <p class="bl-share-note">Your stats live only in this browser.</p>
    </div>`;
    this.img = this.scrim.querySelector('.bl-share-img')!;
    this.me = this.scrim.querySelector('.bl-share-me')!;
    this.imgBtn = this.scrim.querySelector('[data-k=image]')!;
    this.clipBtn = this.scrim.querySelector('[data-k=clip]')!;
    this.textBtn = this.scrim.querySelector('[data-k=text]')!;
    this.textEl = this.scrim.querySelector('.bl-share-text')!;
    this.note = this.scrim.querySelector('.bl-share-note')!;
    this.scrim.querySelector('.bl-share-x')!.addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', (e) => { if (e.target === this.scrim) this.close(); });
    this.scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.imgBtn.addEventListener('click', () => void this.shareImage());
    this.clipBtn.addEventListener('click', () => void this.shareClip());
    this.textBtn.addEventListener('click', () => void this.shareTextLine());
    root.appendChild(this.scrim);
  }

  /** True when an event target is part of the share UI (game keys must not fire there). */
  owns(el: EventTarget | null): boolean {
    return el instanceof Node && (this.bar.contains(el) || this.scrim.contains(el));
  }

  get isOpen(): boolean { return !this.scrim.hidden; }

  /** A death happened. `hud` is what the HUD showed just before it (for the clip). */
  onDeath(e: DeathEvent, stats: PersonalStats, wasPart: boolean, hud: Omit<ReplayHud, 'deathTick'>): void {
    if (this.p?.image) URL.revokeObjectURL(this.p.image.url);
    const share: DeathShare = {
      death: e.deaths, run: e.run, progress: e.progress, cause: e.cause, zoneIndex: e.zone,
      zoneName: this.deps.level.zones[e.zone]?.name ?? '', peak: e.peak ?? 0, peakActive: e.peakActive ?? 0,
      secs: e.secs ?? 0, nearRecord: e.nearRecord, wasPart, stats,
    };
    const p: Pending = { share, hud: null, deathTick: null, frames: null, image: null, imageP: null, clip: null, clipP: null };
    this.p = p;
    this.shownAt = performance.now();
    this.mainBtn.querySelector('span')!.textContent = `Share death #${fmt(e.deaths)}`;
    this.mainBtn.setAttribute('aria-label', `Share death number ${fmt(e.deaths)}: image and text`);
    this.bar.hidden = false;
    if (this.isOpen) this.fillPanel();

    // Wait for the first 'dying' frame of this run: that tick is the moment of death.
    const t0 = performance.now();
    const findDeath = () => {
      if (this.p !== p) return;
      const f = this.deps.recorder.latest;
      if (f && f.run === e.run && f.phase === 'dying') {
        const first = this.deps.recorder.slice(f.tick - 2 * TICK_HZ, f.tick).find((x) => x.run === e.run && x.phase === 'dying') ?? f;
        p.deathTick = first.tick;
        p.hud = { ...hud, deathTick: first.tick };
        // the image needs ~0.5 s after the death for the squash; the clip ~1.8 s
        setTimeout(() => this.renderImage(p), 600);
        setTimeout(() => {
          if (p.deathTick === null) return;
          p.frames = this.deps.recorder.slice(p.deathTick - Math.ceil((CLIP_BEFORE_S + 0.5) * TICK_HZ), p.deathTick + Math.ceil(CLIP_AFTER_S * TICK_HZ));
          this.refreshButtons();
        }, (CLIP_AFTER_S + 0.2) * 1000);
        return;
      }
      if (performance.now() - t0 < WAIT_DEATH_FRAME_MS) setTimeout(findDeath, 50);
    };
    findDeath();
  }

  /** Called every animation frame with where the death card ends (CSS px). */
  update(cardBottom: number): void {
    if (this.bar.hidden) return;
    if (performance.now() - this.shownAt > PILL_S * 1000 && !this.isOpen) { this.bar.hidden = true; return; }
    const top = Math.max(cardBottom + 16, 140);
    this.bar.style.top = `${Math.round(top)}px`;
  }

  private renderImage(p: Pending): void {
    if (p.deathTick === null || p.imageP) return;
    const frames = this.deps.recorder.slice(p.deathTick - 2 * TICK_HZ, p.deathTick + TICK_HZ);
    if (!frames.length) return;
    p.imageP = renderShareImage(this.deps.level, this.deps.sceneLevel, frames, p.deathTick, p.share, this.host)
      .then(({ blob }) => {
        p.image = { blob, url: URL.createObjectURL(blob) };
        if (this.p === p && this.isOpen) this.fillPanel();
      })
      .catch((err) => console.warn('share image failed', err));
  }

  private text(): string { return this.p ? shareText(this.p.share, this.deps.siteUrl) : ''; }
  private fileName(ext: string): string { return `blobocracy-death-${this.p?.share.death ?? 0}.${ext}`; }

  /** The main button: the system share sheet with image + text where the device has one. */
  private async oneTap(): Promise<void> {
    const p = this.p;
    if (!p) return;
    if (p.image && typeof navigator.share === 'function') {
      const file = new File([p.image.blob], this.fileName('png'), { type: 'image/png' });
      if (canShareFiles(file)) {
        try {
          await navigator.share({ files: [file], text: this.text() });
          this.deps.onShare?.('image', 'sheet');
          return;
        } catch (err) {
          if ((err as DOMException).name === 'AbortError') return; // they changed their mind
        }
      }
    }
    this.open(); // desktop, image still rendering, or the sheet refused: show the options
  }

  open(): void {
    if (!this.p) return;
    this.deps.onOpen?.();
    this.lastFocus = document.activeElement;
    this.fillPanel();
    this.scrim.hidden = false;
    this.imgBtn.focus();
  }

  close(): void {
    this.scrim.hidden = true;
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private fillPanel(): void {
    const p = this.p;
    if (!p) return;
    const s = p.share;
    this.img.alt = `Blob death number ${fmt(s.death)}: run ${fmt(s.run)} made it ${Math.floor(s.progress * 100)}% of the way before the ${causeName(s.cause)} got it.`;
    if (p.image) this.img.src = p.image.url; else this.img.removeAttribute('src');
    const me = statsLine(s.stats);
    this.me.textContent = me ? `Me: ${me}` : 'Press anything during a run to start your own tally.';
    this.textEl.value = this.text();
    this.refreshButtons();
  }

  private refreshButtons(): void {
    const p = this.p;
    if (!p) return;
    const sheet = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
    this.imgBtn.innerHTML = `${sheet ? 'Share image' : 'Download image'} <small>${p.image ? 'with the text' : 'drawing…'}</small>`;
    this.imgBtn.disabled = !p.image;
    if (!p.clipP) {
      this.clipBtn.innerHTML = `Make a clip <small>${p.frames ? '9 s vertical video' : 'catching the last seconds…'}</small>`;
      this.clipBtn.disabled = !p.frames;
    } else if (p.clip) {
      this.clipBtn.innerHTML = `${sheet ? 'Share clip' : 'Download clip'} <small>${(p.clip.blob.size / 1e6).toFixed(1)} MB ${p.clip.ext.toUpperCase()}</small>`;
      this.clipBtn.disabled = false;
    }
    if (!this.textBtn.dataset.done) this.textBtn.innerHTML = 'Copy text <small>for group chats</small>';
  }

  private async shareImage(): Promise<void> {
    const p = this.p;
    if (!p?.image) return;
    const file = new File([p.image.blob], this.fileName('png'), { type: 'image/png' });
    if (typeof navigator.share === 'function' && canShareFiles(file)) {
      try {
        await navigator.share({ files: [file], text: this.text() });
        this.deps.onShare?.('image', 'sheet');
      } catch { /* cancelled */ }
      return;
    }
    download(p.image.blob, this.fileName('png'));
    await copyText(this.text(), this.textEl);
    this.note.textContent = 'Image saved, and the text is copied, ready to paste.';
    this.deps.onShare?.('image', 'download');
  }

  private async shareClip(): Promise<void> {
    const p = this.p;
    if (!p?.frames || !p.hud) return;
    if (!p.clipP) {
      this.clipBtn.disabled = true;
      const { renderClip } = await import('./clip.ts');
      p.clipP = renderClip({
        level: this.deps.level, sceneLevel: this.deps.sceneLevel, frames: p.frames, hud: p.hud, death: p.share, host: this.host,
      }, (k) => {
        if (this.p === p) this.clipBtn.innerHTML = `Making your clip… <small>${Math.round(k * 100)}%</small>`;
      });
      try {
        p.clip = await p.clipP;
      } catch (err) {
        console.warn('clip failed', err);
        p.clipP = null;
        this.clipBtn.innerHTML = 'Clip failed <small>try again</small>';
        this.clipBtn.disabled = false;
        return;
      }
      if (this.p === p) this.refreshButtons();
      return; // sharing needs a fresh tap: browsers only allow the share sheet right after one
    }
    if (!p.clip) return;
    const file = new File([p.clip.blob], this.fileName(p.clip.ext), { type: p.clip.mime.split(';')[0] });
    if (typeof navigator.share === 'function' && canShareFiles(file)) {
      try {
        await navigator.share({ files: [file], text: this.text() });
        this.deps.onShare?.('clip', 'sheet');
      } catch { /* cancelled */ }
      return;
    }
    download(p.clip.blob, this.fileName(p.clip.ext));
    this.deps.onShare?.('clip', 'download');
  }

  private async shareTextLine(): Promise<void> {
    const ok = await copyText(this.text(), this.textEl);
    this.textBtn.dataset.done = '1';
    this.textBtn.innerHTML = ok ? 'Copied <small>paste it anywhere</small>' : 'Select the text below <small>and copy it</small>';
    setTimeout(() => { delete this.textBtn.dataset.done; this.refreshButtons(); }, 2500);
    if (ok) this.deps.onShare?.('text', 'copy');
  }
}

export { shareUrl };
