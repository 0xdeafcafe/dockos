// games/grid.tsx — shared plumbing for the retro diagnostic mini-games.
// Character-grid measurement follows the useVisibleLines pattern from ui/scroll.tsx,
// extended to columns via a monospace probe. Everything renders to unicode text —
// the playfield is strings, never canvas/SVG, per the TUI rules in styles/global.css.
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./games.css";

export type MutRef<T> = { current: T };

export type CharGrid = { cols: number; rows: number };

// How many character cells fit in the container: rows from line-height, columns
// from a 100-glyph probe of the actual rendered font (more exact than 1ch rounding).
export function useCharGrid(): [MutRef<HTMLDivElement | null>, CharGrid] {
  const ref = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<CharGrid>({ cols: 60, rows: 18 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // oxlint-disable-next-line unicorn/prefer-number-coercion -- lineHeight resolves to "16.8px"; Number() would NaN
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 17;
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(100);
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.whiteSpace = "pre";
      el.append(probe);
      const chw = probe.getBoundingClientRect().width / 100 || 8.4;
      probe.remove();
      const cols = Math.max(10, Math.floor(el.clientWidth / chw));
      const rows = Math.max(4, Math.floor(el.clientHeight / lh));
      setGrid((g) => (g.cols === cols && g.rows === rows ? g : { cols, rows }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, grid];
}

// A blank w×h field of spaces; write glyphs with put().
export function makeCells(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => " "));
}

// Write a glyph run at (x, y), clipped to the field — never throws off-grid.
export function put(cells: string[][], x: number, y: number, glyphs: string): void {
  const row = cells[y];
  if (!row) return;
  for (let i = 0; i < glyphs.length; i += 1) {
    const cx = x + i;
    if (cx >= 0 && cx < row.length) row[cx] = glyphs[i] ?? " ";
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Institutional zero-padded counters: 02, 014, …
export function pad(n: number, width = 2): string {
  return String(Math.max(0, Math.floor(n))).padStart(width, "0");
}

// Split a centred label into [left-pad, label, right-pad] so the label alone can
// carry a tone/flash class while the padding stays plain field.
export function centerSpan(text: string, width: number): [string, string, string] {
  const t = text.length > width ? text.slice(0, Math.max(0, width)) : text;
  const left = Math.max(0, Math.floor((width - t.length) / 2));
  const right = Math.max(0, width - t.length - left);
  return [" ".repeat(left), t, " ".repeat(right)];
}

// The playfield rows plus the shared overlay choreography: on game over the report
// strobes as a SUPERHOT inverse row with the reboot hint two rows under it; while
// paused a dim notice sits mid-field. Every row is 1lh of pre text between ║ rails.
export function fieldRows(
  cells: string[][],
  width: number,
  overMsg: string | null,
  pausedMsg: string | null,
): ReactNode[] {
  const midY = Math.floor((cells.length - 1) / 2);
  const rows: ReactNode[] = [];
  for (let y = 0; y < cells.length; y += 1) {
    let inner: ReactNode = cells[y]?.join("") ?? "";
    if (overMsg && y === midY) {
      const [l, t, r] = centerSpan(` ${overMsg} `, width);
      inner = (
        <>
          {l}
          <span className="game__flash">{t}</span>
          {r}
        </>
      );
    } else if (overMsg && y === midY + 2) {
      const [l, t, r] = centerSpan("PRESS R TO REBOOT · Q TO QUIT", width);
      inner = (
        <>
          {l}
          <span className="ink--accent">{t}</span>
          {r}
        </>
      );
    } else if (pausedMsg && !overMsg && y === midY) {
      const [l, t, r] = centerSpan(pausedMsg, width);
      inner = (
        <>
          {l}
          <span className="ink--dim">{t}</span>
          {r}
        </>
      );
    }
    rows.push(
      // oxlint-disable-next-line react/no-array-index-key -- field rows ARE positional slots
      <div className="game__row" key={y}>
        <span className="ink--dim">║</span>
        {inner}
        <span className="ink--dim">║</span>
      </div>,
    );
  }
  return rows;
}

// ╔═ TITLE ═══…╗ — the game's nameplate lives in the frame, accent on dim rails.
export function FrameTop({ cols, title }: { cols: number; title: string }) {
  const cut = title.slice(0, Math.max(0, cols - 6));
  const fill = Math.max(0, cols - 5 - cut.length);
  return (
    <div className="game__row ink--dim">
      {"╔═ "}
      <span className="ink--accent">{cut}</span>
      {" " + "═".repeat(fill) + "╗"}
    </div>
  );
}

export function FrameBottom({ cols }: { cols: number }) {
  return <div className="game__row ink--dim">{"╚" + "═".repeat(Math.max(0, cols - 2)) + "╝"}</div>;
}
