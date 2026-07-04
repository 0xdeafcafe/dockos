import { useEffect } from "react";

type Pane = "nav" | "main";

// TUI pane focus: TAB or ←/→ (h/l) moves focus BETWEEN panes; the focused pane draws the
// double ╔═╗ frame and captures the keyboard. ":" or "/" hands the keyboard to the command
// bar — while it types, every shell key is suspended (⌘K excepted).
export function usePaneKeys(opts: {
  paletteOpen: boolean;
  cmdActive: boolean;
  setPane: (p: Pane) => void;
  togglePane: () => void;
  back: () => void;
  openPalette: () => void;
  focusCmd: () => void;
}) {
  const { paletteOpen, cmdActive, setPane, togglePane, back, openPalette, focusCmd } = opts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
        return;
      }
      // any real input owns the keyboard — first Esc blurs it, shell keys stay out of it
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT") {
        if (e.key === "Escape") target.blur();
        return;
      }
      // a focused button rides the roving-row arrows (ui/focus.ts) — not pane switching
      if (target?.tagName === "BUTTON" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        return;
      }
      if (paletteOpen || cmdActive) return;
      if (e.key === ":") {
        e.preventDefault();
        focusCmd();
      } else if (e.key === "Tab") {
        e.preventDefault();
        togglePane();
      } else if (e.key === "ArrowLeft" || e.key === "h") setPane("nav");
      else if (e.key === "ArrowRight" || e.key === "l") setPane("main");
      else if (e.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, cmdActive, setPane, togglePane, back, openPalette, focusCmd]);
}
