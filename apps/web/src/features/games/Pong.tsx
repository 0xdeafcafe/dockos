import { useEffect, useRef, useState } from "react";
import { Text } from "../../ui/text.tsx";
import { fieldRows, FrameBottom, FrameTop, pad, useCharGrid } from "./grid.tsx";
import { FX, FxLayer, freshFx, shardRows, shudderOn, tearOn, useReducedMotion } from "./gamefx.tsx";
import type { FxState } from "./gamefx.tsx";
import { drawPong, freshPong, pongKeys, stepPong, TICK_MS, TITLE, WIN } from "./pongCore.ts";
import type { PongState } from "./pongCore.ts";
import "./games.css";

// PONG.SYS — DIAGNOSTIC PADDLE ROUTINE. An easter egg for placeholder panels: crew
// (left paddle, W/S or ↑/↓) versus MU/TH/UR (right paddle, simple pursuit AI). Pure
// game logic lives in pongCore.ts; the SUPERHOT game-feel lives in gamefx.tsx —
// impact flash + shudder + chromatic tear on every bounce/point, a block-art word
// slam on scores, time-bend that hangs the ball a beat before a paddle then snaps, an
// afterimage trail, and a shard-noise shatter on each point. Base tick 50ms; game
// state in refs, one render per tick (the loop self-reschedules so the tick can bend).

function PongStatus({ crew, muthur }: { crew: number; muthur: number }) {
  return (
    <div className="game__status">
      <span>
        <Text tone="text">CREW </Text>
        <Text tone="accent" bold>
          {pad(crew)}
        </Text>
        <Text tone="text"> · MU/TH/UR </Text>
        <Text tone="accent" bold>
          {pad(muthur)}
        </Text>
        <Text tone="dim"> — FIRST TO {pad(WIN)}</Text>
      </span>
      <span className="ink--dim">W/S ↑/↓ MOVE · P PAUSE · Q QUIT</span>
    </div>
  );
}

export function Pong({ active, onExit }: { active: boolean; onExit: () => void }) {
  const [ref, grid] = useCharGrid();
  const [, force] = useState(0);
  const dims = useRef(grid);
  dims.current = grid;
  const st = useRef<PongState | null>(null);
  const held = useRef<Set<"up" | "down">>(new Set());
  const fx = useRef<FxState>(freshFx(TICK_MS));
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // the game loop: self-rescheduling so the tick delay can BEND around impacts
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      if (!alive) return;
      stepPong(st, dims.current, held.current, fx.current, reducedRef.current);
      force((n) => n + 1);
      timer = setTimeout(loop, fx.current.nextDelay);
    };
    timer = setTimeout(loop, TICK_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active]);

  // leaving the panel freezes the match rather than letting MU/TH/UR farm points
  useEffect(() => {
    if (active) return;
    held.current.clear();
    const s = st.current;
    if (s && !s.over) s.paused = true;
  }, [active]);

  // keyboard only while active
  useEffect(() => {
    if (!active) return;
    const { down, up } = pongKeys(st, held.current, () => force((n) => n + 1), onExit);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [active, onExit]);

  const innerW = grid.cols - 2;
  const fieldH = grid.rows - 3;
  const tooSmall = innerW < 24 || fieldH < 6;
  const s = tooSmall ? null : (st.current ??= freshPong(innerW, fieldH));
  const overMsg =
    s?.over === "crew"
      ? "MU/TH/UR OVERRIDDEN — CREW PREVAILS"
      : s?.over === "muthur"
        ? "CREW TERMINATED — ROUTINE FAILED"
        : null;
  const now = Date.now();
  const f = fx.current;
  const shatterLive = !reduced && now - f.shatterAt < FX.shatter;
  const cells = s ? (shatterLive ? shardRows(innerW, fieldH) : drawPong(s, innerW, fieldH)) : [];
  const containerCls = `game${shudderOn(f, now, reduced) ? " game--shudder" : ""}`;
  const fieldCls = `game__field${tearOn(f, now, reduced) ? " game__field--tear" : ""}`;

  return (
    <div ref={ref} className={containerCls} aria-label="pong — diagnostic paddle routine">
      {s ? (
        <>
          <PongStatus crew={s.crew} muthur={s.muthur} />
          <FrameTop cols={grid.cols} title={TITLE} />
          <div className={fieldCls}>
            {fieldRows(cells, innerW, overMsg, s.paused ? "▮▮ PAUSED — P TO RESUME" : null)}
          </div>
          <FrameBottom cols={grid.cols} />
          <FxLayer fx={f} now={now} reduced={reduced} />
        </>
      ) : (
        <div className="game__row ink--dim">VIEWPORT TOO SMALL — ENLARGE TERMINAL</div>
      )}
    </div>
  );
}
