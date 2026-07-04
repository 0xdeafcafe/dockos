import type { ReactNode } from "react";
import { useRovingRow } from "./focus.ts";
import "./ink.css";

export interface Action {
  key: string; // displayed key cap: "R", "↵", "J/K"
  label: string;
  onRun?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

// The visible twin of every keyboard shortcut: [R] RESTART buttons in a roving row.
// Nothing on the deck is keyboard-only — if a key does it, a button shows it.
export function ActionBar({ items, lead }: { items: Action[]; lead?: ReactNode }) {
  const roving = useRovingRow<HTMLDivElement>();
  return (
    <div className="ink-actionbar" role="toolbar" tabIndex={-1} onKeyDown={roving}>
      {lead ? <span className="ink-actionbar__lead">{lead}</span> : null}
      {items.map((a) =>
        a.onRun ? (
          <button
            key={a.key + a.label}
            className={`ink-act ${a.danger ? "ink-act--danger" : ""}`}
            disabled={a.disabled}
            onClick={a.onRun}
          >
            <span className="ink-act__key">[{a.key}]</span> {a.label}
          </button>
        ) : (
          <span key={a.key + a.label} className="ink-act ink-act--static">
            <span className="ink-act__key">[{a.key}]</span> {a.label}
          </span>
        ),
      )}
    </div>
  );
}
