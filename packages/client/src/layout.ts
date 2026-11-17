// Screen layout and camera. All world positions are in tiles (x right, y down).

export interface Layout {
  w: number;
  h: number;
  dpr: number;
  tile: number;
  groundY: number;
  lookAhead: number;
  phone: boolean;
}

/** World row that the usual ground surface sits on; the camera anchors it to `groundY`. */
export const GROUND_ROW = 13;

export function computeLayout(w: number, h: number, dpr: number): Layout {
  const phone = h > w * 1.15;
  if (phone) return { w, h, dpr, phone, tile: w / 10.3, groundY: 0.715 * h, lookAhead: 3.4 };
  return { w, h, dpr, phone, tile: h / 16, groundY: 0.733 * h, lookAhead: 9.6 };
}

function targetOf(layout: Layout, focus: { x: number; y: number }): { x: number; y: number } {
  const above = layout.groundY / layout.tile; // tiles visible above the ground line
  const anchor = GROUND_ROW - above;
  // Normally the ground row sits at groundY; when the blob climbs high, follow it up
  // so it stays a little above the middle of the screen (never down past the anchor).
  const follow = focus.y - above * 0.55;
  return { x: focus.x - layout.lookAhead, y: Math.min(anchor, follow) };
}

const FOLLOW_RATE = 5; // 1/s, exponential ease
const MAX_SPEED = 40; // tiles/s, so a long frame gap or a re-layout never teleports the view

/** Left/top edge of the view in tiles, eased toward the focus. */
export function camera(
  layout: Layout,
  focus: { x: number; y: number },
  prev: { x: number; y: number } | null,
  dtS: number,
): { x: number; y: number } {
  const t = targetOf(layout, focus);
  if (!prev) return t;
  const dt = Math.min(Math.max(dtS, 0), 0.25);
  const k = 1 - Math.exp(-FOLLOW_RATE * dt);
  const lim = MAX_SPEED * dt;
  const dx = clamp((t.x - prev.x) * k, -lim, lim);
  const dy = clamp((t.y - prev.y) * k, -lim, lim);
  return { x: prev.x + dx, y: prev.y + dy };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
