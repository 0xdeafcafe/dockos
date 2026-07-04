import { useEffect } from "react";
import type { ReactNode } from "react";
import { TermScroll } from "./scroll.tsx";
import { keyOwnedByWidget } from "./focus.ts";
import "./ink.css";

const NO_LINES: ReactNode[] = [];

// THE table: one selection model for every list on the deck. Hover moves the cursor,
// the inverse bar IS the cursor, j/k/↑↓ move it, ↵ opens. Views own their columns —
// they format the header string and each row; TuiTable owns selection, keys, scroll.
export function TuiTable<T>({
  head,
  rows,
  sel,
  onSel,
  onOpen,
  active,
  renderRow,
  above = NO_LINES,
  below = NO_LINES,
  empty = "— NOTHING HERE ▮ —",
}: {
  head: string;
  rows: T[];
  sel: number;
  onSel: (i: number) => void;
  onOpen?: (row: T) => void;
  active: boolean;
  renderRow: (row: T, selected: boolean, i: number) => ReactNode;
  // extra lines scrolled with the table (banners above, command echoes below)
  above?: ReactNode[];
  below?: ReactNode[];
  empty?: string;
}) {
  const clamped = Math.min(sel, Math.max(0, rows.length - 1));

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "ArrowDown" || e.key === "j") onSel(Math.min(rows.length - 1, clamped + 1));
      else if (e.key === "ArrowUp" || e.key === "k") onSel(Math.max(0, clamped - 1));
      else if (e.key === "Enter" && rows[clamped] !== undefined) onOpen?.(rows[clamped] as T);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, rows, clamped, onSel, onOpen]);

  const lines: ReactNode[] = [
    ...above,
    <span className="ink-table__head" key="head">
      {head}
    </span>,
    ...rows.map((r, i) => renderRow(r, i === clamped, i)),
    ...(rows.length === 0
      ? [
          <span className="ink-table__head" key="empty">
            {empty}
          </span>,
        ]
      : []),
    ...below,
  ];

  return <TermScroll lines={lines} />;
}
