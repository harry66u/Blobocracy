// Hazard icons for run history, drawn in the game's hazard language (spec §6.5): hot-pink
// hazards with thick plum outlines, cream ground, the grumpy press, the saw, the Big Chomp.
const INK = '#2A1B3D', PINK = '#FF3B7A', PINK_DARK = '#D61F5C', CREAM_SHADE = '#F2D8AE', BLOB = '#FFD21F', PLUM = '#4A1238';

const svg = (body: string, label: string) =>
  `<svg class="hz" viewBox="0 0 32 32" role="img" aria-label="${label}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const ICONS: Record<string, string> = {
  spikes: `<rect x="2" y="23" width="28" height="7" rx="2.5" fill="${CREAM_SHADE}"/><path d="M4 23L9 11L14 23M13 23L18 9L23 23M22 23L26.5 13L31 23" fill="${PINK}"/><path d="M16 14.5L18 10" stroke="#fff" stroke-width="1.6" opacity=".7"/>`,
  'ceiling spikes': `<rect x="2" y="2" width="28" height="7" rx="2.5" fill="${CREAM_SHADE}"/><path d="M4 9L9 21L14 9M13 9L18 23L23 9M22 9L26.5 19L31 9" fill="${PINK}"/>`,
  pit: `<path d="M9.5 16v14h13V16" fill="${PLUM}"/><rect x="1.5" y="14" width="9" height="16" rx="2.5" fill="${CREAM_SHADE}"/><rect x="21.5" y="14" width="9" height="16" rx="2.5" fill="${CREAM_SHADE}"/><path d="M3 17.5h6M23 17.5h6" stroke="#fff" stroke-width="1.6" opacity=".8"/><path d="M10.8 27.5a5.2 5.2 0 0 1 10.4 0z" fill="${BLOB}" stroke-width="2"/><circle cx="14.2" cy="25" r="1.1" fill="${INK}" stroke="none"/><circle cx="17.8" cy="25" r="1.1" fill="${INK}" stroke="none"/><path d="M12 4.5l1.6 4.5M20 4.5l-1.6 4.5M16 3v5" stroke-width="2"/>`,
  press: `<path d="M16 1v4" stroke-width="2"/><rect x="5" y="5" width="22" height="17" rx="3.5" fill="${PINK}"/><path d="M5 22l3.7 5 3.6-5 3.7 5 3.7-5 3.6 5 3.7-5" fill="${PINK_DARK}"/><path d="M9.5 11.5l4 2M22.5 11.5l-4 2" stroke-width="2.2"/><circle cx="12.5" cy="14.5" r="1.3" fill="${INK}" stroke="none"/><circle cx="19.5" cy="14.5" r="1.3" fill="${INK}" stroke="none"/><path d="M13 18.5h6" stroke-width="2"/>`,
  saw: `<path d="M16 2.5l2.6 3.8 4.4-1.3.4 4.6 4.3 1.6-2 4.1 2.9 3.5-4 2.3.3 4.6-4.5-.4-1.9 4.2L16 27l-2.6 2.5-1.9-4.2-4.5.4.3-4.6-4-2.3 2.9-3.5-2-4.1 4.3-1.6.4-4.6 4.4 1.3z" fill="${PINK}"/><circle cx="16" cy="16" r="5.6" fill="#E9E1F0"/><circle cx="16" cy="16" r="1.8" fill="${INK}" stroke="none"/>`,
  chomp: `<path d="M2.5 9.5Q16 -1 29.5 9.5V22.5Q16 33 2.5 22.5Z" fill="${PINK}"/><path d="M5 12.5Q16 7 27 12.5V19.5Q16 25 5 19.5Z" fill="${PLUM}"/><path d="M6 12.2l2.6 3.4 2.4-4.4 2.6 3.9 2.4-4.4 2.4 4.4 2.6-3.9 2.4 4.4L26 12.2M6 19.8l2.6-3.4 2.4 4.4 2.6-3.9L16 21.3l2.4-4.4 2.6 3.9 2.4-4.4L26 19.8" fill="#fff" stroke-width="1.6"/><circle cx="10" cy="6.5" r="1.5" fill="${INK}" stroke="none"/><circle cx="22" cy="6.5" r="1.5" fill="${INK}" stroke="none"/>`,
  win: `<path d="M9 4h14v6a7 7 0 0 1-14 0z" fill="${BLOB}"/><path d="M9 6H4.5q0 6 5.2 6.5M23 6h4.5q0 6-5.2 6.5" /><path d="M16 17v5M10.5 28h11l-1.5-6h-8z" fill="${BLOB}"/><path d="M13 7.5l1.5 3" stroke="#fff" stroke-width="1.6"/>`,
};

/** An inline SVG for what ended a run (a generic hazard for anything unknown). */
export function hazardIcon(cause: string, label: string): string {
  return svg(ICONS[cause] ?? ICONS.spikes!, label);
}

/** The blob from the loading screen, as markup (mood: calm, worried, happy). */
export function blobSvg(cls: string, mood: 'calm' | 'worried' | 'happy' = 'calm'): string {
  const face = mood === 'worried'
    ? `<path d="M-23-58l15-6M8-64l15 6" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><circle cx="-13" cy="-43" r="3.3" fill="${INK}"/><circle cx="13" cy="-43" r="3.3" fill="${INK}"/><ellipse cx="0" cy="-22" rx="4.5" ry="6" fill="${INK}"/>`
    : mood === 'happy'
      ? `<circle cx="-11" cy="-47" r="5" fill="${INK}"/><circle cx="15" cy="-47" r="5" fill="${INK}"/><path d="M-10-27Q0-13 10-27Z" fill="${INK}"/><path d="M-6-21Q0-17 6-21" stroke="${PINK}" stroke-width="3" stroke-linecap="round"/>`
      : `<circle cx="-10" cy="-47" r="5" fill="${INK}"/><circle cx="16" cy="-47" r="5" fill="${INK}"/><path d="M-6-25Q0-19 6-25" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
  return `<svg class="${cls}" viewBox="-44 -84 88 88" aria-hidden="true">
  <path d="M0-78C25-78 40-58 40-34C40-10 26 0 0 0C-26 0-40-10-40-34C-40-58-25-78 0-78Z" fill="${BLOB}"/>
  <path d="M-38-22C-30 2 30 2 39-22C36-4 22 0 0 0C-22 0-36-6-38-22Z" fill="#F2B300"/>
  <ellipse cx="-20" cy="-60" rx="9" ry="5" transform="rotate(-35 -20 -60)" fill="#fff" opacity=".85"/>
  <path d="M0-78C25-78 40-58 40-34C40-10 26 0 0 0C-26 0-40-10-40-34C-40-58-25-78 0-78Z" fill="none" stroke="${INK}" stroke-width="5"/>
  <ellipse cx="-13" cy="-44" rx="10" ry="12" fill="#fff" stroke="${INK}" stroke-width="3.5"/>
  <ellipse cx="13" cy="-44" rx="10" ry="12" fill="#fff" stroke="${INK}" stroke-width="3.5"/>
  ${face}
  <ellipse cx="-24" cy="-26" rx="5" ry="3" fill="#FF5A78" opacity=".3"/><ellipse cx="24" cy="-26" rx="5" ry="3" fill="#FF5A78" opacity=".3"/>
</svg>`;
}
