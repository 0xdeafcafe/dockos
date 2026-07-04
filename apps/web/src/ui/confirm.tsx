import { useEffect, useRef } from "react";
import { Box } from "./box.tsx";
import { Text } from "./text.tsx";
import { keyOwnedByWidget, useRovingRow } from "./focus.ts";
import "./ink.css";

export interface Pending {
  question: string; // "TERMINATE MEDIA?"
  label?: string; // confirm verb, default EXECUTE
  detail?: string; // one-line consequence line
  danger?: boolean; // red frame (kill) vs accent frame (restart)
  run: () => void;
}

// The SUPERHOT decision beat, shared by every disruptive action on the deck: a centered
// modal over a dimmed scrim, heavy frame, two big buttons. Y/↵ executes, N/Esc aborts,
// and it disarms itself after a beat — the deck never stays armed. Owns its keys (capture).
export function ConfirmStrip({ pending, onDone }: { pending: Pending; onDone: () => void }) {
  const roving = useRovingRow<HTMLDivElement>();
  const goRef = useRef<HTMLButtonElement>(null);
  const commit = () => {
    pending.run();
    onDone();
  };

  // opening the dialog puts the cursor on ABORT-adjacent EXECUTE — arrows walk the pair
  useEffect(() => {
    goRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(onDone, 8000);
    return () => clearTimeout(t);
  }, [onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      const k = e.key.toLowerCase();
      if (k === "y" || e.key === "Enter") commit();
      else if (k === "n" || e.key === "Escape") onDone();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Tab") return;
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- commit closes over stable pending
  }, [pending, onDone]);

  const tone = pending.danger ? "err" : "accent";
  return (
    <div className={`confirm ${pending.danger ? "confirm--danger" : ""}`}>
      <div className="confirm__dialog">
        <Box
          title={<Text tone={tone}>{pending.danger ? "✖ CONFIRM" : "◈ CONFIRM"}</Text>}
          border="heavy"
          tone={tone}
        >
          <div className="confirm__gap"> </div>
          <div className="confirm__q">{pending.question}</div>
          <div className="confirm__detail">
            {pending.detail ?? "this cannot be undone from here."}
          </div>
          <div className="confirm__gap"> </div>
          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- roving toolbar */}
          <div className="confirm__btns" role="toolbar" tabIndex={-1} onKeyDown={roving}>
            <button ref={goRef} className="confirm__btn confirm__btn--go" onClick={commit}>
              [Y] {pending.label ?? "EXECUTE"}
            </button>
            <button className="confirm__btn" onClick={onDone}>
              [N] ABORT
            </button>
          </div>
          <div className="confirm__gap"> </div>
        </Box>
      </div>
    </div>
  );
}
