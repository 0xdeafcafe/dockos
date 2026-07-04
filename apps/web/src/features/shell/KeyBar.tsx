import type { View } from "./views.ts";

const COMMON = [
  ["TAB", "PANE"],
  [":", "COMMAND"],
  ["⌘K", "PALETTE"],
  ["ESC", "BACK"],
] as const;

const BY_VIEW: Partial<Record<View, ReadonlyArray<readonly [string, string]>>> = {
  fleet: [
    ["↵", "INSPECT"],
    ["R", "RESTART"],
    ["P", "PAUSE"],
    ["D", "KILL"],
    ["S", "SORT"],
    ["/", "FILTER"],
    ["J/K", "MOVE"],
  ],
  detail: [
    ["1-4", "TABS"],
    ["R", "RESTART"],
    ["D", "KILL"],
  ],
  stacks: [
    ["J/K", "MOVE"],
    ["↵", "UP/DOWN"],
    ["U", "PULL"],
    ["P", "PONG.SYS"],
  ],
  networks: [
    ["J/K", "AREA"],
    ["↵", "INSPECT"],
    ["G", "SNAKE.SYS"],
  ],
  system: [
    ["J/K", "MOVE"],
    ["U", "CHECK"],
    ["P", "PULL"],
  ],
  images: [
    ["J/K", "MOVE"],
    ["↵", "INSPECT"],
    ["U", "PULL"],
    ["X", "PRUNE"],
    ["D", "PURGE"],
  ],
  volumes: [
    ["J/K", "MOVE"],
    ["↵", "INSPECT"],
    ["X", "REMOVE"],
  ],
  settings: [
    ["J/K", "MOVE"],
    ["←/→", "CHANGE"],
  ],
};

// The footer legend: view keys first, │, the common chords, breadcrumb hard right.
// Key caps render inverse-accent — the same visual weight as a focused control.
export function KeyBar({ view, crumb }: { view: View; crumb: string }) {
  const viewKeys = BY_VIEW[view] ?? [];
  return (
    <footer className="keybar">
      {viewKeys.map(([k, label]) => (
        <span key={k} className="keybar__item">
          <span className="keybar__cap">{k}</span> {label}
        </span>
      ))}
      {viewKeys.length > 0 ? <span className="keybar__sep">│</span> : null}
      {COMMON.map(([k, label]) => (
        <span key={k} className="keybar__item">
          <span className="keybar__cap">{k}</span> {label}
        </span>
      ))}
      <span className="keybar__spacer" />
      <span className="keybar__crumb">DECK ▸ {crumb}</span>
      <span className="keybar__stamp">DOCK/OS-v0.1p</span>
    </footer>
  );
}
