// Pure text-chart helpers. Everything renders to strings of unicode — no SVG, no canvas.

const BLOCKS = " ▁▂▃▄▅▆▇█";

// Compact sparkline: one row of 8-level block glyphs. Scale is FIXED (default 0–100)
// so a flat 3% line reads flat — never window-max-normalized into a solid bar.
export function sparkText(data: number[], max = 100): string {
  return data
    .map((v) => BLOCKS[Math.max(1, Math.min(8, Math.round((v / max) * 8)))] ?? "▁")
    .join("");
}

// Left-to-right level gauge: █ fills, ░ remains. Level, where sparkText is trend.
export function gaugeText(value: number, width = 8, max = 100): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// Vertical partial-block levels, filled from the BOTTOM of the cell (0..8 eighths).
const VBLOCKS = " ▁▂▃▄▅▆▇█";

// Block-column area chart: one full-width glyph per column, each a stack of solid █ topped by an
// 8-level partial cap. Replaces the old Braille chart, whose 2×4 micro-dots turned to an illegible
// smear under the CRT barrel warp — these big block features stay readable bent. `max` is the FIXED
// top of the scale (default 0–100, matching sparkText and the cpu%/mem% the charts carry): a steady
// 43% reads at 43% height, never window-max-normalized (which pinned flat lines to the top and
// flooded the plot solid). Fills from the bottom, so a low value leaves the TOP rows empty — no
// top-row clipping. Pass an explicit `max` for non-percentage series.
export function blockChart(data: number[], wChars: number, hChars: number, max = 100): string[] {
  const top = max > 0 ? max : Math.max(1, ...data);
  const totalEighths = hChars * 8;

  // resample to one column per output glyph
  const cols: number[] = [];
  for (let x = 0; x < wChars; x += 1) {
    const t = data.length <= 1 ? 0 : (x / Math.max(1, wChars - 1)) * (data.length - 1);
    const i = Math.floor(t);
    const a = data[i] ?? 0;
    const b = data[Math.min(data.length - 1, i + 1)] ?? a;
    const v = a + (b - a) * (t - i);
    const norm = Math.max(0, Math.min(1, v / top));
    cols.push(Math.round(norm * totalEighths));
  }

  const rows: string[] = [];
  for (let cy = 0; cy < hChars; cy += 1) {
    // cy=0 is the TOP row; the bottom row fills first
    const cellBottomEighths = (hChars - 1 - cy) * 8;
    let line = "";
    for (let x = 0; x < wChars; x += 1) {
      const level = Math.max(0, Math.min(8, (cols[x] ?? 0) - cellBottomEighths));
      line += VBLOCKS[level] ?? " ";
    }
    rows.push(line);
  }
  return rows;
}

// Random shard text for the SUPERHOT shatter effect.
const SHARDS = "▚▞▖▘▝▗ ·  ";
export function shardText(len: number): string {
  let s = "";
  for (let i = 0; i < len; i += 1) s += SHARDS[Math.floor(Math.random() * SHARDS.length)] ?? " ";
  return s;
}

// Ash for the kill decay — heavier at the left, thinning out as the row crumbles.
const ASH = "▓▒░░  ·   ";
export function ashText(len: number): string {
  let s = "";
  for (let i = 0; i < len; i += 1) s += ASH[Math.floor(Math.random() * ASH.length)] ?? " ";
  return s;
}
