// snakeDraw — NET.TRACE field rendering, split from snakeCore.ts to keep both files
// under the 300-line house limit. Everything writes into the char grid; the SUPERHOT
// motion lives in CSS (gamefx.css), this module only picks glyphs.
import { makeCells, put } from "./grid.tsx";
import type { Obstacle, SnakeState } from "./snakeCore.ts";

// how long a breached topology node flickers double-lined after the packet slips in
const NODE_FLICKER = 380;

// Draw a topology node box: border chars + centred label written OVER the field, with
// the interior left transparent so the packet shows through behind it. A breached node
// flickers to double-line box glyphs.
function drawBox(cells: string[][], o: Obstacle, breached: boolean): void {
  const g = breached
    ? { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" }
    : { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };
  const x0 = o.x * 2;
  const y0 = o.y;
  const wc = Math.max(2, o.w * 2);
  const hc = Math.max(1, o.h);
  const inner = Math.max(0, wc - 2);
  const lab = o.label.slice(0, inner);
  const labX = x0 + 1 + Math.floor((inner - lab.length) / 2);
  if (hc === 1) {
    put(cells, x0, y0, g.tl + g.h.repeat(inner) + g.tr);
    if (lab) put(cells, labX, y0, lab);
    return;
  }
  put(cells, x0, y0, g.tl + g.h.repeat(inner) + g.tr);
  put(cells, x0, y0 + hc - 1, g.bl + g.h.repeat(inner) + g.br);
  for (let y = y0 + 1; y < y0 + hc - 1; y += 1) {
    put(cells, x0, y, g.v);
    put(cells, x0 + wc - 1, y, g.v);
  }
  if (lab) put(cells, labX, y0 + Math.floor(hc / 2), lab);
}

export function drawSnake(
  s: SnakeState,
  w: number,
  h: number,
  obs: Obstacle[],
  now: number,
  reduced: boolean,
): string[][] {
  const cells = makeCells(w, h);
  for (const n of s.nodes) put(cells, n.x * 2, n.y, "▤▤");
  put(cells, s.food.x * 2, s.food.y, "◆");
  // the tail shimmers ▓/▒ down its length; the shimmer creeps as tick advances
  s.body.forEach((seg, i) => {
    const glyph = i === 0 ? "██" : reduced || (i + s.tick) % 2 === 0 ? "▓▓" : "▒▒";
    put(cells, seg.x * 2, seg.y, glyph);
  });
  // topology boxes render LAST so the packet tunnels BEHIND them
  for (let i = 0; i < obs.length; i += 1) {
    const o = obs[i];
    if (o) drawBox(cells, o, !reduced && now - (s.breached[i] ?? 0) < NODE_FLICKER);
  }
  return cells;
}
