// pongCore — the pure state/step/draw for PONG.SYS, split out of Pong.tsx so the React
// shell stays small (house rule: files under 300 lines). See Pong.tsx for the routine's
// premise; the SUPERHOT dressing (flash/shudder/tear/slam/time-bend/trail/shatter) is
// wired through the FxState from gamefx.tsx.
import { keyOwnedByWidget } from "../../ui/focus.ts";
import { clamp, makeCells, put } from "./grid.tsx";
import type { CharGrid, MutRef } from "./grid.tsx";
import { impact, shatter, slam } from "./gamefx.tsx";
import type { FxState } from "./gamefx.tsx";

export const TICK_MS = 50;
export const WIN = 5;
// cells per tick — char cells are ~2:1, so vertical speed runs shallower
const BASE_VX = 0.85;
// time-bend: the tick stretches this much while the ball hangs at a paddle's face
const BEND = 2;
export const TITLE = "PONG.SYS — DIAGNOSTIC PADDLE ROUTINE";
// afterimage glyphs, freshest first — dimming via glyph weight, not colour (one field ink)
const TRAIL = ["•", "∙", "·"];

export type Side = "crew" | "muthur";
export type Held = Set<"up" | "down">;

export type PongState = {
  bx: number;
  by: number;
  vx: number;
  vy: number;
  // padL/padR track the TOP row of each paddle
  padL: number;
  padR: number;
  crew: number;
  muthur: number;
  paused: boolean;
  over: Side | null;
  // recent ball cells for the fading afterimage trail
  trail: { x: number; y: number }[];
};

function padH(h: number): number {
  return Math.max(3, Math.min(7, Math.floor(h / 4)));
}

function serve(s: PongState, w: number, h: number, toward: -1 | 1): void {
  s.bx = (w - 1) / 2;
  s.by = (h - 1) / 2;
  s.vx = BASE_VX * toward;
  s.vy = (Math.random() - 0.5) * 0.5;
  s.trail = [];
}

export function freshPong(w: number, h: number): PongState {
  const top = Math.max(0, Math.floor((h - padH(h)) / 2));
  const s: PongState = {
    bx: 0,
    by: 0,
    vx: 0,
    vy: 0,
    padL: top,
    padR: top,
    crew: 0,
    muthur: 0,
    paused: false,
    over: null,
    trail: [],
  };
  serve(s, w, h, Math.random() < 0.5 ? -1 : 1);
  return s;
}

// A point lands: score, then fire the SUPERHOT beat — flash + shudder + tear, a shard
// shatter of the field, and a word slam (GAME/TERMINATED on match point, else SCORE).
function score(s: PongState, who: Side, w: number, h: number, fx: FxState): void {
  s[who] += 1;
  impact(fx, "score");
  shatter(fx);
  fx.nextDelay = TICK_MS;
  if (s[who] >= WIN) {
    s.over = who;
    if (who === "crew") slam(fx, "GAME", "accent");
    else slam(fx, "TERMINATED", "err");
    return;
  }
  slam(fx, "SCORE", who === "crew" ? "accent" : "err");
  serve(s, w, h, who === "crew" ? -1 : 1);
}

function bounce(s: PongState, prevBx: number, face: number, padTop: number, ph: number): boolean {
  const inbound =
    face === 2
      ? s.vx < 0 && prevBx > face && s.bx <= face
      : s.vx > 0 && prevBx < face && s.bx >= face;
  if (!inbound || s.by < padTop - 0.5 || s.by > padTop + ph - 0.5) return false;
  s.bx = 2 * face - s.bx;
  // every return runs a little hotter, with spin from the contact offset
  s.vx = clamp(-s.vx * 1.05, -2.2, 2.2);
  s.vy = clamp(s.vy + (s.by - (padTop + (ph - 1) / 2)) * 0.11, -0.85, 0.85);
  return true;
}

export function stepPong(
  st: MutRef<PongState | null>,
  grid: CharGrid,
  held: Held,
  fx: FxState,
  reduced: boolean,
): void {
  // interior columns inside ║…║; height minus status row + top/bottom frame
  const w = grid.cols - 2;
  const h = grid.rows - 3;
  if (w < 24 || h < 6) return;
  const s = (st.current ??= freshPong(w, h));
  if (s.paused || s.over) return;
  const ph = padH(h);

  // crew paddle: held keys, 1 row per tick
  if (held.has("up")) s.padL -= 1;
  if (held.has("down")) s.padL += 1;
  s.padL = clamp(s.padL, 0, h - ph);

  // MU/TH/UR pursues the ball, faster when it is inbound — quick, but beatable
  const aiSpeed = s.vx > 0 ? 0.72 : 0.34;
  s.padR = clamp(s.padR + clamp(s.by - (ph - 1) / 2 - s.padR, -aiSpeed, aiSpeed), 0, h - ph);

  const prevBx = s.bx;
  const prevRx = Math.round(clamp(s.bx, 0, w - 1));
  const prevRy = Math.round(clamp(s.by, 0, h - 1));
  s.bx += s.vx;
  s.by += s.vy;

  // top/bottom bulkheads reflect — each bounce is a (light) impact
  let wall = false;
  if (s.by < 0) {
    s.by = -s.by;
    s.vy = Math.abs(s.vy);
    wall = true;
  }
  if (s.by > h - 1) {
    s.by = 2 * (h - 1) - s.by;
    s.vy = -Math.abs(s.vy);
    wall = true;
  }
  s.by = clamp(s.by, 0, h - 1);

  // paddles sit at cols 1 and w-2; the ball bounces off their inner faces
  const bounced = bounce(s, prevBx, 2, s.padL, ph) || bounce(s, prevBx, w - 3, s.padR, ph);
  if (bounced || wall) impact(fx, "hit");

  // record the vacated cell for the afterimage trail (freshest at head)
  s.trail.unshift({ x: prevRx, y: prevRy });
  if (s.trail.length > TRAIL.length) s.trail.pop();

  if (s.bx < 0) score(s, "muthur", w, h, fx);
  else if (s.bx > w - 1) score(s, "crew", w, h, fx);
  else {
    // TIME-BEND: as the ball nears the paddle it is aimed at, and lines up with it,
    // stretch the next tick so it HANGS — then it snaps through on contact.
    const face = s.vx > 0 ? w - 3 : 2;
    const dist = Math.abs(face - s.bx);
    const padTop = s.vx > 0 ? s.padR : s.padL;
    const aligned = s.by >= padTop - 0.5 && s.by <= padTop + ph - 0.5;
    fx.nextDelay =
      !reduced && !bounced && dist > 0.4 && dist < 2.6 && aligned
        ? Math.round(TICK_MS * BEND)
        : TICK_MS;
  }
}

export function drawPong(s: PongState, w: number, h: number): string[][] {
  const cells = makeCells(w, h);
  const net = Math.floor(w / 2);
  for (let y = 0; y < h; y += 2) put(cells, net, y, "┆");
  const ph = padH(h);
  for (let i = 0; i < ph; i += 1) {
    put(cells, 1, Math.round(s.padL) + i, "█");
    put(cells, w - 2, Math.round(s.padR) + i, "█");
  }
  // afterimage first, live ball last so it always wins its cell
  for (let i = 0; i < s.trail.length; i += 1) {
    const t = s.trail[i];
    if (t) put(cells, t.x, t.y, TRAIL[i] ?? "·");
  }
  put(cells, Math.round(clamp(s.bx, 0, w - 1)), Math.round(s.by), "●");
  return cells;
}

// keyboard handlers; handled keys stop propagation so the shell's own chords never
// fire while the routine is running.
export function pongKeys(
  st: MutRef<PongState | null>,
  held: Held,
  rerender: () => void,
  onExit: () => void,
): { down: (e: KeyboardEvent) => void; up: (e: KeyboardEvent) => void } {
  const down = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || keyOwnedByWidget(e)) return;
    const k = e.key.toLowerCase();
    let handled = true;
    if (k === "w" || k === "arrowup") held.add("up");
    else if (k === "s" || k === "arrowdown") held.add("down");
    else if (k === "p") {
      const s = st.current;
      if (s && !s.over) {
        s.paused = !s.paused;
        rerender();
      }
    } else if (k === "r") {
      // reboot — fresh state materialises on the next render
      st.current = null;
      rerender();
    } else if (k === "q" || k === "escape") onExit();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const up = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") held.delete("up");
    if (k === "s" || k === "arrowdown") held.delete("down");
  };
  return { down, up };
}
