import { useEffect, useRef, useState } from "react";
import { Box } from "../ui/box.tsx";
import { Cursor, Rule, Text } from "../ui/text.tsx";
import { useRovingRow } from "../ui/focus.ts";
import type { ClientError } from "./types.ts";
import "./errors.css";

function useTypewriter(text: string): string {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    let i = 0;
    setTyped("");
    const t = setInterval(() => {
      i += 1;
      setTyped(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [text]);
  return typed;
}

function FaultBody({ error, typed }: { error: ClientError; typed: string }) {
  const meta = error.meta
    ? Object.entries(error.meta)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("  ")
    : null;
  return (
    <>
      <div className="fault__row">
        <span className="fault__key">KIND</span>
        <span className="fault__kind">{error.kind}</span>
      </div>
      <div className="fault__row">
        <span className="fault__key">MSG</span>
        <span>
          {typed}
          <Cursor />
        </span>
      </div>
      {meta ? (
        <div className="fault__row">
          <span className="fault__key">META</span>
          <span className="fault__meta">{meta}</span>
        </div>
      ) : null}
      {error.hint ? (
        <>
          <Rule tone="err" ch="╌" />
          <div className="fault__hint">▓ {error.hint}</div>
        </>
      ) : null}
    </>
  );
}

export function ErrorDialog({
  error,
  onDismiss,
  onRetry,
}: {
  error: ClientError;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const typed = useTypewriter(error.message);
  const roving = useRovingRow<HTMLDivElement>();
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
      else if (e.key === "Enter" && onRetry) onRetry();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss, onRetry]);

  // opening the fault puts the cursor on its first action; ←/→ walk the pair
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div
      className="fault__scrim"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onDismiss()}
    >
      {/* whole-page red crash on entry — the "big error, uh oh" flash, then it clears to the panel */}
      <div className="fault__crash" aria-hidden />
      <div className="fault" role="alertdialog" aria-label="system fault">
        <Box title={<Text tone="err">✖ SYSTEM FAULT</Text>} border="heavy" tone="err">
          <FaultBody error={error} typed={typed} />
          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- roving toolbar */}
          <div className="fault__actions" role="toolbar" tabIndex={-1} onKeyDown={roving}>
            {onRetry ? (
              <button ref={firstRef} className="fault__btn" onClick={onRetry}>
                [ RETRY ]
              </button>
            ) : null}
            <button ref={onRetry ? undefined : firstRef} className="fault__btn" onClick={onDismiss}>
              [ DISMISS ]
            </button>
          </div>
        </Box>
      </div>
    </div>
  );
}
