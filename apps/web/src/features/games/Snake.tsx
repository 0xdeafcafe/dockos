import { useEffect, useRef, useState } from "react";
import { Text } from "../../ui/text.tsx";
import { fieldRows, FrameBottom, FrameTop, pad, useCharGrid } from "./grid.tsx";
import { FX, FxLayer, ashRows, freshFx, shudderOn, tearOn, useReducedMotion } from "./gamefx.tsx";
import type { FxState } from "./gamefx.tsx";
import { freshSnake, PAUSED_MSG, snakeKeys, stepSnake, TICK_MS, TITLE } from "./snakeCore.ts";
import type { Obstacle, SnakeState } from "./snakeCore.ts";
import { drawSnake } from "./snakeDraw.ts";
import "./games.css";

// re-exported so the network view can type the rects it passes in
export type { Obstacle } from "./snakeCore.ts";

// NET.TRACE — the network map's buried game. A packet (██ head, ▓▓/▒▒ shimmering trail)
// snakes across the fabric collecting payloads (◆); every few deliveries the fabric
// grows a firewall node (▤▤) — do not eat the firewall. Pure game logic lives in
// snakeCore.ts; the SUPERHOT game-feel lives in gamefx.tsx (impact flash + shudder +
// tear on eat/death, a "+1"/"ROUTED"/"PACKET LOST"·"FIREWALL BREACH" slam, time-bend
// that hangs the packet before impact then snaps, and an ash decay of the field on
// death). Base tick 120ms; the loop self-reschedules so the tick can bend.
//
// TOPOLOGY MODE: when the network page passes `obstacles` (service node boxes) they
// render as box frames ON TOP of the packet — the packet tunnels BEHIND them, and
// slipping INTO a node's rect BREACHES it (bonus + flicker + flash). Node borders are
// NOT walls; only the outer playfield frame kills.

function SnakeStatus({ score }: { score: number }) {
  return (
    <div className="game__status">
      <span>
        <Text tone="text">PACKETS ROUTED </Text>
        <Text tone="accent" bold>
          {pad(score, 3)}
        </Text>
        <Text tone="dim"> · DO NOT EAT THE FIREWALL ▤</Text>
      </span>
      <span className="ink--dim">←↑↓→/HJKL STEER · P PAUSE · Q QUIT</span>
    </div>
  );
}

// obstacles: optional topology node boxes, in GAME-CELL coordinates. Origin (0,0) is
// the top-left interior cell of the playfield (just inside the frame). Units are the
// same logical game cells the packet and food live in — one cell is 2 chars wide × 1
// row tall, so a box at {x,y,w,h} occupies chars [x*2 … (x+w)*2) and rows [y … y+h).
// Omit it (default) and NET.TRACE plays exactly as before.
export function Snake({
  active,
  onExit,
  obstacles,
}: {
  active: boolean;
  onExit: () => void;
  obstacles?: Obstacle[];
}) {
  const [ref, grid] = useCharGrid();
  const [, force] = useState(0);
  const dims = useRef(grid);
  dims.current = grid;
  const st = useRef<SnakeState | null>(null);
  const fx = useRef<FxState>(freshFx(TICK_MS));
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const obs = obstacles ?? [];
  const obsRef = useRef(obs);
  obsRef.current = obs;

  // the game loop: self-rescheduling so the tick delay can BEND around impacts
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      if (!alive) return;
      stepSnake(st, dims.current, fx.current, reducedRef.current, obsRef.current);
      force((n) => n + 1);
      timer = setTimeout(loop, fx.current.nextDelay);
    };
    timer = setTimeout(loop, TICK_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active]);

  // leaving the map holds the packet in flight
  useEffect(() => {
    if (active) return;
    const s = st.current;
    if (s && !s.over) s.paused = true;
  }, [active]);

  // keyboard only while active
  useEffect(() => {
    if (!active) return;
    const down = snakeKeys(st, () => force((n) => n + 1), onExit);
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [active, onExit]);

  const innerW = grid.cols - 2;
  const fieldH = grid.rows - 3;
  const lw = Math.floor(innerW / 2);
  const tooSmall = lw < 8 || fieldH < 6;
  const s = tooSmall ? null : (st.current ??= freshSnake(lw, fieldH));
  const now = Date.now();
  const f = fx.current;
  const ashLive = !reduced && now - f.ashAt < FX.ash;
  const cells = s
    ? ashLive
      ? ashRows(innerW, fieldH)
      : drawSnake(s, innerW, fieldH, obs, now, reduced)
    : [];
  const containerCls = `game${shudderOn(f, now, reduced) ? " game--shudder" : ""}`;
  const fieldCls = `game__field${tearOn(f, now, reduced) ? " game__field--tear" : ""}`;

  return (
    <div ref={ref} className={containerCls} aria-label="net.trace — packet routing exercise">
      {s ? (
        <>
          <SnakeStatus score={s.score} />
          <FrameTop cols={grid.cols} title={TITLE} />
          <div className={fieldCls}>
            {fieldRows(cells, innerW, s.over, s.paused ? PAUSED_MSG : null)}
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
