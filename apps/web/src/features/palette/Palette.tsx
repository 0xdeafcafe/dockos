import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Box } from "../../ui/box.tsx";
import { Rule } from "../../ui/text.tsx";
import { TuiInput } from "../../ui/input.tsx";
import "./palette.css";

export interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

// Buttons are natively accessible — no ARIA roleplay needed; the dialog carries the label.
function PaletteList({
  items,
  sel,
  onSel,
  onRun,
}: {
  items: Command[];
  sel: number;
  onSel: (i: number) => void;
  onRun: (i: number) => void;
}) {
  return (
    <ul className="pal__list">
      {items.map((c, i) => (
        <li key={c.id}>
          <button
            className={`pal__item ${i === sel ? "pal__item--sel" : ""}`}
            onMouseEnter={() => onSel(i)}
            onClick={() => onRun(i)}
          >
            <span>
              {i === sel ? "▸ " : "  "}
              {c.label}
            </span>
            <span className="pal__hint">{c.hint}</span>
          </button>
        </li>
      ))}
      {items.length === 0 ? <li className="pal__empty"> NO MATCHES</li> : null}
    </ul>
  );
}

function usePaletteState(open: boolean, onClose: () => void, commands: Command[]) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(needle));
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const run = (i: number) => {
    filtered[i]?.run();
    onClose();
  };

  const onKeys = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") setSel((s) => Math.min(filtered.length - 1, s + 1));
    else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
    else if (e.key === "Enter") run(sel);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return { q, setQ, sel, setSel, inputRef, filtered, run, onKeys };
}

export function Palette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const p = usePaletteState(open, onClose, commands);

  if (!open) return null;

  return (
    <div
      className="pal__scrim"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <dialog open className="pal" aria-label="command palette" onKeyDown={p.onKeys}>
        <Box title="COMMAND" border="double" tone="accent">
          <div className="pal__prompt">
            <span className="ink--accent">&gt;</span>
            <TuiInput
              value={p.q}
              onChange={(v) => {
                p.setQ(v);
                p.setSel(0);
              }}
              placeholder="type to filter…"
              inputRef={p.inputRef}
            />
          </div>
          <Rule tone="dim" />
          <PaletteList items={p.filtered} sel={p.sel} onSel={p.setSel} onRun={p.run} />
          <Rule tone="dim" />
          <div className="pal__foot">
            <span>ENTER RUN</span>
            <span>⇅ MOVE</span>
            <span>ESC CLOSE</span>
          </div>
        </Box>
      </dialog>
    </div>
  );
}
