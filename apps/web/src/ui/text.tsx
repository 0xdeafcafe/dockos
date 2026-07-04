import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { sparkText } from "./chart.ts";
import "./ink.css";

export type Tone = "text" | "dim" | "accent" | "ok" | "warn" | "err";

export function Text({
  tone = "text",
  bold,
  blink,
  inverse,
  children,
}: {
  tone?: Tone;
  bold?: boolean;
  blink?: boolean;
  inverse?: boolean;
  children: ReactNode;
}) {
  const cls = ["ink--" + tone, bold && "ink--bold", blink && "ink--blink", inverse && "ink--inv"];
  return <span className={cls.filter(Boolean).join(" ")}>{children}</span>;
}

export function Rule({ tone = "dim", ch = "─" }: { tone?: Tone; ch?: string }) {
  // 190 covers the widest pane (shell caps at 176ch); overflow-hidden clips the rest. Not
  // 500 — the extra clipped glyphs bloat the CRT filter's source graphic (see box.tsx).
  return <div className={`ink-rule ink--${tone}`}>{ch.repeat(190)}</div>;
}

export function Key({ children }: { children: ReactNode }) {
  return <span className="ink--accent">{children}</span>;
}

// The classic blinking block cursor.
export function Cursor() {
  return <span className="ink-cursor">▮</span>;
}

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function Spinner({ tone = "accent" }: { tone?: Tone }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SPINNER.length), 90);
    return () => clearInterval(t);
  }, []);
  return <span className={`ink--${tone}`}>{SPINNER[i]}</span>;
}

export type ContainerState = "up" | "paused" | "exited" | "unhealthy";

const STATE_GLYPH: Record<ContainerState, [string, Tone]> = {
  up: ["●", "ok"],
  paused: ["◐", "warn"],
  exited: ["○", "dim"],
  unhealthy: ["!", "err"],
};

export function Dot({ state }: { state: ContainerState }) {
  const [glyph, tone] = STATE_GLYPH[state];
  return <span className={`ink--${tone} ink-dot--${state}`}>{glyph}</span>;
}

export function Bar({
  value,
  tone = "accent",
  width = 10,
}: {
  value: number;
  tone?: Tone;
  width?: number;
}) {
  const filled = Math.max(0, Math.min(width, Math.round((value / 100) * width)));
  return (
    <span className="ink-bar">
      <span className={`ink--${tone}`}>{"█".repeat(filled)}</span>
      <span className="ink--dim">{"░".repeat(width - filled)}</span>
    </span>
  );
}

export function Spark({ data, tone = "accent" }: { data: number[]; tone?: Tone }) {
  return <span className={`ink-spark ink--${tone}`}>{sparkText(data)}</span>;
}
