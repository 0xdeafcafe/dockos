import { useEffect, useState } from "react";
import type { View } from "./views.ts";

const NAV: Array<{ view: View; label: string }> = [
  { view: "fleet", label: "CONTAINERS" },
  { view: "stacks", label: "STACKS" },
  { view: "system", label: "SYSTEM" },
  { view: "images", label: "IMAGES" },
  { view: "volumes", label: "VOLUMES" },
  { view: "networks", label: "NETWORKS" },
  { view: "settings", label: "SETTINGS" },
];

function useNavCursor(view: View, focused: boolean, onView: (v: View) => void) {
  const current = NAV.findIndex(
    (n) => n.view === view || (view === "detail" && n.view === "fleet"),
  );
  const [sel, setSel] = useState(Math.max(0, current));

  useEffect(() => {
    if (current >= 0) setSel(current);
  }, [current]);

  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") setSel((s) => Math.min(NAV.length - 1, s + 1));
      else if (e.key === "ArrowUp" || e.key === "k") setSel((s) => Math.max(0, s - 1));
      else if (e.key === "Enter") {
        const target = NAV[sel];
        if (target) onView(target.view);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, sel, onView]);

  return sel;
}

// TUI pane: when this pane holds focus, j/k move the cursor row and ↵ commits the view.
// Hover previews the same inverse focus style; click commits directly.
export function NavRail({
  view,
  focused,
  alert,
  cveWarn,
  onView,
}: {
  view: View;
  focused: boolean;
  alert: boolean; // a unit is unhealthy and the alarm is live → CONTAINERS flickers red
  cveWarn: boolean; // images carry crit/high CVEs → SYSTEM warns amber (steady)
  onView: (v: View) => void;
}) {
  const sel = useNavCursor(view, focused, onView);

  return (
    <nav>
      {NAV.map((n, i) => {
        const active = n.view === view || (view === "detail" && n.view === "fleet");
        const cursor = focused && i === sel;
        const plain = !active && !cursor;
        const redFlag = alert && n.view === "fleet" && plain;
        const amberFlag = cveWarn && n.view === "system" && plain;
        const cls = [
          "nav__item",
          active || cursor ? "nav__item--active" : "",
          redFlag ? "nav__item--alert" : "",
          amberFlag ? "nav__item--warn" : "",
        ];
        return (
          <button key={n.view} className={cls.join(" ")} onClick={() => onView(n.view)}>
            {cursor || active ? "▸ " : redFlag ? "! " : amberFlag ? "▲ " : "  "}
            {n.label}
          </button>
        );
      })}
    </nav>
  );
}
