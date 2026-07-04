import type { CSSProperties, ReactNode } from "react";
import type { Tone } from "./text.tsx";
import "./ink.css";

export type BorderStyle = "single" | "double" | "heavy" | "round";

interface Glyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
}

// Rails only need to cover the widest / tallest possible pane (shell caps at 176ch). The
// old 500/400 counts painted ~thousands of extra clipped glyphs per box — a big source
// graphic that the CRT filter had to re-rasterize on every pass. Cover, don't overshoot.
const RAIL_H = 190;
const RAIL_V = 110;

const BORDERS: Record<BorderStyle, Glyphs> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
  heavy: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
  round: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
};

// A pane framed in literal box-drawing characters — never a CSS border.
// Frame hierarchy: single = pane · double = focused pane / modal · heavy = error.
// `fill` grows the box to its flex parent; `actions` sits right-aligned in the top rail.
export function Box({
  title,
  tone = "dim",
  border = "single",
  focus = false,
  pad = true,
  fill = false,
  actions,
  children,
  style,
}: {
  title?: ReactNode;
  tone?: Tone;
  border?: BorderStyle;
  focus?: boolean;
  pad?: boolean;
  fill?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const g = BORDERS[focus && border === "single" ? "double" : border];
  return (
    <div
      className={`ink-box ${focus ? "ink-box--focus" : ""} ${fill ? "ink-box--fill" : ""} ink--${focus ? "accent" : tone}`}
      style={style}
    >
      <span className="ink-box__cnr">{g.tl}</span>
      <div className="ink-box__edge">
        {title ? (
          <span className="ink-box__title">
            {g.h} {title}{" "}
          </span>
        ) : (
          <span>{g.h}</span>
        )}
        <span className="ink-box__fill">{g.h.repeat(RAIL_H)}</span>
        {actions ? (
          <span className="ink-box__actions">
            {g.h} {actions} {g.h}
          </span>
        ) : null}
      </div>
      <span className="ink-box__cnr">{g.tr}</span>
      <div className="ink-box__side">{g.v.repeat(RAIL_V)}</div>
      <div className={`ink-box__body ${pad ? "ink-box__body--pad" : ""}`}>{children}</div>
      <div className="ink-box__side">{g.v.repeat(RAIL_V)}</div>
      <span className="ink-box__cnr">{g.bl}</span>
      <div className="ink-box__edge">
        <span className="ink-box__fill">{g.h.repeat(RAIL_H)}</span>
      </div>
      <span className="ink-box__cnr">{g.br}</span>
    </div>
  );
}
