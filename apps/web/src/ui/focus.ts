import { useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

// ONE focus language for every region: ←/→ (Home/End) rove among the focusables inside
// a container; :focus-visible renders inverse-video (global.css) — identical to hover.
// Pane-level keys never see roving arrows (stopPropagation + BUTTON guard in usePaneKeys).

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled])";

export function useRovingRow<T extends HTMLElement>() {
  return useCallback((e: ReactKeyboardEvent<T>) => {
    const target = e.target as HTMLElement | null;
    // arrows inside a text input move the caret, not the focus
    if (target?.tagName === "INPUT") return;
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (!horizontal && e.key !== "Home" && e.key !== "End") return;

    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : at === -1
            ? 0
            : (at + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
    e.stopPropagation();
  }, []);
}

// Window-level key handlers call this first: when a real widget (button/input) owns the
// event, activation keys belong to IT — the view must not double-fire Enter/Space.
export function keyOwnedByWidget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT") return true;
  return tag === "BUTTON" && (e.key === "Enter" || e.key === " ");
}
