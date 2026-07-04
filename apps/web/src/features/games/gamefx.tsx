// gamefx — the SUPERHOT game-feel layer shared by the diagnostic mini-games.
// Everything here is text + toggled CSS classes, per the TUI rules: no canvas, no
// per-cell React churn. Effects are driven off timestamps stashed in a plain FxState
// object (one per game, held in a ref) and READ at render time — the games already
// re-render every tick, so a `now - stampAt < window` test naturally expires each
// effect without extra state or timers. Slams/flashes mount a single keyed overlay
// so their CSS animation replays crisply on every fresh event.
import { useEffect, useState } from "react";
import { ashText, shardText } from "../../ui/chart.ts";
import "./gamefx.css";

export type FxKind = "hit" | "score" | "death";
export type SlamTone = "accent" | "err";

// Effect windows, ms. Kept short so the field reads clean between hits.
export const FX = {
  flash: 130,
  shake: 220,
  tear: 240,
  slam: 620,
  shatter: 200,
  ash: 640,
} as const;

export type FxState = {
  // impact flash + shudder + chromatic tear all fire together on a hard event
  flashAt: number;
  flashKind: FxKind;
  shakeAt: number;
  tearAt: number;
  // block-art word punch
  slamAt: number;
  slamWord: string;
  slamTone: SlamTone;
  // field dissolves: Pong shatters to shards on a point, Snake decays to ash on death
  shatterAt: number;
  ashAt: number;
  // time-bend: the loop reads this each tick to ease the interval up before impact
  nextDelay: number;
};

export function freshFx(baseDelay: number): FxState {
  return {
    flashAt: 0,
    flashKind: "hit",
    shakeAt: 0,
    tearAt: 0,
    slamAt: 0,
    slamWord: "",
    slamTone: "accent",
    shatterAt: 0,
    ashAt: 0,
    nextDelay: baseDelay,
  };
}

// The impact bundle: full-field flash + screen shudder + chromatic tear, in one beat.
export function impact(fx: FxState, kind: FxKind, now = Date.now()): void {
  fx.flashAt = now;
  fx.flashKind = kind;
  fx.shakeAt = now;
  fx.tearAt = now;
}

export function slam(fx: FxState, word: string, tone: SlamTone, now = Date.now()): void {
  fx.slamAt = now;
  fx.slamWord = word;
  fx.slamTone = tone;
}

export function shatter(fx: FxState, now = Date.now()): void {
  fx.shatterAt = now;
}

export function decay(fx: FxState, now = Date.now()): void {
  fx.ashAt = now;
}

// Field-dissolve helpers — one row of noise per field row. Called only inside the
// short shatter/ash windows, so the random regen per tick animates the static.
export function shardRows(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => [...shardText(w)]);
}
export function ashRows(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => [...ashText(w)]);
}

// prefers-reduced-motion, live. When true the games gate every shake/flash/tear/slam
// and pin the tick to its base delay (no time-bend) so play stays flat but functional.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// Container/field class helpers — pushed onto the base class when a window is live.
export function shudderOn(fx: FxState, now: number, reduced: boolean): boolean {
  return !reduced && now - fx.shakeAt < FX.shake;
}
export function tearOn(fx: FxState, now: number, reduced: boolean): boolean {
  return !reduced && now - fx.tearAt < FX.tear;
}

// The overlay layer: a keyed flash div (replays per event) and the block-art slam.
// Absolutely positioned inside the game panel, above the field. Nothing under reduced
// motion — the textual game-over report in fieldRows still carries the outcome.
export function FxLayer({ fx, now, reduced }: { fx: FxState; now: number; reduced: boolean }) {
  if (reduced) return null;
  const flash = now - fx.flashAt < FX.flash;
  const slamLive = now - fx.slamAt < FX.slam;
  if (!flash && !slamLive) return null;
  return (
    <>
      {flash && (
        <div key={fx.flashAt} className={`gfx-flash gfx-flash--${fx.flashKind}`} aria-hidden />
      )}
      {slamLive && (
        <div key={fx.slamAt} className={`gfx-slam gfx-slam--${fx.slamTone}`} aria-hidden>
          <pre className="gfx-slam__word">{renderGameWord(fx.slamWord)}</pre>
        </div>
      )}
    </>
  );
}

// LOCAL block font — a self-contained cousin of ui/blockfont.ts. We can only edit
// files under features/games/, so the game slams need their own glyphs (SCORE, GAME,
// TERMINATED, ROUTED, LOST, BREACH, +1). Same 6-row weight and visual language.
const GLYPHS: Record<string, string[]> = {
  A: [" █████ ", "██   ██", "██   ██", "███████", "██   ██", "██   ██"],
  B: ["██████ ", "██   ██", "██████ ", "██   ██", "██   ██", "██████ "],
  C: [" ██████", "██     ", "██     ", "██     ", "██     ", " ██████"],
  D: ["██████ ", "██   ██", "██   ██", "██   ██", "██   ██", "██████ "],
  E: ["███████", "██     ", "█████  ", "██     ", "██     ", "███████"],
  F: ["███████", "██     ", "█████  ", "██     ", "██     ", "██     "],
  G: [" ██████", "██     ", "██  ███", "██   ██", "██   ██", " ██████"],
  H: ["██   ██", "██   ██", "███████", "██   ██", "██   ██", "██   ██"],
  I: ["██████", "  ██  ", "  ██  ", "  ██  ", "  ██  ", "██████"],
  K: ["██   ██", "██  ██ ", "█████  ", "██  ██ ", "██   ██", "██   ██"],
  L: ["██     ", "██     ", "██     ", "██     ", "██     ", "███████"],
  M: ["██   ██", "███ ███", "███████", "██ █ ██", "██   ██", "██   ██"],
  N: ["██   ██", "███  ██", "████ ██", "██ ████", "██  ███", "██   ██"],
  O: [" █████ ", "██   ██", "██   ██", "██   ██", "██   ██", " █████ "],
  P: ["██████ ", "██   ██", "██████ ", "██     ", "██     ", "██     "],
  R: ["██████ ", "██   ██", "██████ ", "██  ██ ", "██   ██", "██   ██"],
  S: [" ██████", "██     ", " █████ ", "     ██", "     ██", "██████ "],
  T: ["████████", "   ██   ", "   ██   ", "   ██   ", "   ██   ", "   ██   "],
  U: ["██   ██", "██   ██", "██   ██", "██   ██", "██   ██", " █████ "],
  W: ["██   ██", "██   ██", "██ █ ██", "███████", "███ ███", "██   ██"],
  "0": [" █████ ", "██   ██", "██  ███", "███  ██", "██   ██", " █████ "],
  "1": ["  ██  ", " ███  ", "  ██  ", "  ██  ", "  ██  ", "██████"],
  "2": [" █████ ", "██   ██", "    ██ ", "  ██   ", " ██    ", "███████"],
  "3": ["██████ ", "     ██", "  ████ ", "     ██", "██   ██", " █████ "],
  "4": ["██   ██", "██   ██", "███████", "     ██", "     ██", "     ██"],
  "5": ["███████", "██     ", "██████ ", "     ██", "██   ██", " █████ "],
  "6": [" █████ ", "██     ", "██████ ", "██   ██", "██   ██", " █████ "],
  "7": ["███████", "     ██", "    ██ ", "   ██  ", "  ██   ", "  ██   "],
  "8": [" █████ ", "██   ██", " █████ ", "██   ██", "██   ██", " █████ "],
  "9": [" █████ ", "██   ██", " ██████", "     ██", "     ██", " █████ "],
  "+": ["      ", "  ██  ", "██████", "██████", "  ██  ", "      "],
  " ": ["     ", "     ", "     ", "     ", "     ", "     "],
};

export function renderGameWord(word: string): string {
  const rows: string[] = [];
  for (let r = 0; r < 6; r += 1) {
    rows.push(
      [...word.toUpperCase()].map((ch) => GLYPHS[ch]?.[r] ?? GLYPHS[" "]?.[r] ?? "").join("  "),
    );
  }
  return rows.join("\n");
}
