// snakeCore — the pure state/step/draw for NET.TRACE, split out of Snake.tsx so the
// React shell stays small (house rule: files under 300 lines). See Snake.tsx for the
// premise, the topology-obstacle contract, and the coordinate convention. The SUPERHOT
// dressing (flash/shudder/tear/slam/time-bend/shimmer/ash) is wired through FxState.
import { keyOwnedByWidget } from "../../ui/focus.ts";
import { clamp } from "./grid.tsx";
import type { CharGrid, MutRef } from "./grid.tsx";
import { decay, impact, slam } from "./gamefx.tsx";
import type { FxState } from "./gamefx.tsx";

export const TICK_MS = 120;
// a firewall node racks up every 5 packets routed, capped so the fabric stays fair
const NODE_EVERY = 5;
const MAX_NODES = 8;
// time-bend: the tick stretches this much while the packet hangs before impact
const BEND = 1.7;
export const TITLE = "NET.TRACE — PACKET ROUTING EXERCISE";
export const PAUSED_MSG = "▮▮ PACKET HELD — P OR STEER TO RESUME";

type Cell = { x: number; y: number };

// A topology node box, in GAME-CELL coordinates (see Snake.tsx for the convention).
export type Obstacle = { label: string; x: number; y: number; w: number; h: number };

export type SnakeState = {
  // head first
  body: Cell[];
  dir: Cell;
  // buffered turns — two quick keys inside one tick both land
  queue: Cell[];
  food: Cell;
  nodes: Cell[];
  score: number;
  paused: boolean;
  // the death report, when the packet is gone
  over: string | null;
  // parity counter that drives the trail shimmer
  tick: number;
  // obstacle index → last-breach timestamp, for the flicker
  breached: Record<number, number>;
  // obstacle index the head currently sits inside, or -1
  insideNode: number;
};

const DIRS: Record<string, Cell> = {
  arrowup: { x: 0, y: -1 },
  k: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
  j: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  h: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  l: { x: 1, y: 0 },
};

function occupied(s: SnakeState, x: number, y: number): boolean {
  return (
    s.body.some((c) => c.x === x && c.y === y) ||
    s.nodes.some((c) => c.x === x && c.y === y) ||
    (s.food.x === x && s.food.y === y)
  );
}

// Index of the topology node whose rect contains (x, y), or -1. Rects use GAME-CELL
// coordinates: x∈[o.x, o.x+o.w-1], y∈[o.y, o.y+o.h-1].
function rectIndex(obs: Obstacle[], x: number, y: number): number {
  for (let i = 0; i < obs.length; i += 1) {
    const o = obs[i];
    if (o && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return i;
  }
  return -1;
}

function spawnFree(s: SnakeState, lw: number, lh: number, minHeadDist = 0): Cell | null {
  const head = s.body[0];
  for (let tries = 0; tries < 200; tries += 1) {
    const x = Math.floor(Math.random() * lw);
    const y = Math.floor(Math.random() * lh);
    if (occupied(s, x, y)) continue;
    if (head && Math.abs(x - head.x) + Math.abs(y - head.y) < minHeadDist) continue;
    return { x, y };
  }
  return null;
}

// Packet payloads prefer to land inside/near topology nodes so the player is drawn to
// route THROUGH the boxes; falls back to a plain free cell when there are none.
function spawnFood(s: SnakeState, lw: number, lh: number, obs: Obstacle[]): Cell {
  if (obs.length > 0 && Math.random() < 0.6) {
    for (let tries = 0; tries < 40; tries += 1) {
      const o = obs[Math.floor(Math.random() * obs.length)];
      if (!o) continue;
      const x = o.x + Math.floor(Math.random() * Math.max(1, o.w));
      const y = o.y + Math.floor(Math.random() * Math.max(1, o.h));
      if (x < 0 || y < 0 || x >= lw || y >= lh) continue;
      if (occupied(s, x, y)) continue;
      const head = s.body[0];
      if (head && Math.abs(x - head.x) + Math.abs(y - head.y) < 2) continue;
      return { x, y };
    }
  }
  return spawnFree(s, lw, lh, 2) ?? s.food;
}

export function freshSnake(lw: number, lh: number): SnakeState {
  const cx = Math.floor(lw / 2);
  const cy = Math.floor(lh / 2);
  const s: SnakeState = {
    body: [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ],
    dir: { x: 1, y: 0 },
    queue: [],
    food: { x: 0, y: 0 },
    nodes: [],
    score: 0,
    paused: false,
    over: null,
    tick: 0,
    breached: {},
    insideNode: -1,
  };
  s.food = spawnFree(s, lw, lh, 4) ?? { x: Math.max(0, lw - 2), y: cy };
  return s;
}

// The packet is gone: report + the SUPERHOT death beat (flash + shudder + tear, an ash
// decay of the field, and a red word slam).
function die(s: SnakeState, fx: FxState, report: string, word: string): void {
  s.over = report;
  impact(fx, "death");
  decay(fx);
  slam(fx, word, "err");
  fx.nextDelay = TICK_MS;
}

// resize housekeeping: pull the world back inside the fabric — no unfair deaths
function refit(s: SnakeState, lw: number, lh: number): void {
  for (const seg of s.body) {
    seg.x = clamp(seg.x, 0, lw - 1);
    seg.y = clamp(seg.y, 0, lh - 1);
  }
  s.nodes = s.nodes.filter((n) => n.x < lw && n.y < lh);
  if (s.food.x >= lw || s.food.y >= lh) s.food = spawnFree(s, lw, lh) ?? { x: 0, y: 0 };
}

// TIME-BEND: peek the cell the packet enters NEXT tick; if it's a wall, firewall,
// itself, or food, stretch this tick so the packet hangs, then it snaps through.
function bendAhead(s: SnakeState, fx: FxState, lw: number, lh: number, reduced: boolean): void {
  const nh = s.body[0];
  if (!nh) {
    fx.nextDelay = TICK_MS;
    return;
  }
  const px = nh.x + s.dir.x;
  const py = nh.y + s.dir.y;
  const danger =
    px < 0 ||
    py < 0 ||
    px >= lw ||
    py >= lh ||
    s.nodes.some((n) => n.x === px && n.y === py) ||
    s.body.some((c) => c.x === px && c.y === py);
  const foodAhead = px === s.food.x && py === s.food.y;
  fx.nextDelay = !reduced && (danger || foodAhead) ? Math.round(TICK_MS * BEND) : TICK_MS;
}

// award an eaten packet — score, flash, and the occasional slam; respawns the payload
function eatFood(
  s: SnakeState,
  fx: FxState,
  lw: number,
  lh: number,
  obs: Obstacle[],
  now: number,
): void {
  s.score += 1;
  impact(fx, "hit", now);
  if (s.score % NODE_EVERY === 0) {
    slam(fx, "ROUTED", "accent", now);
    if (s.nodes.length < MAX_NODES) {
      const n = spawnFree(s, lw, lh, 4);
      if (n) s.nodes.push(n);
    }
  } else if (Math.random() < 0.4) {
    slam(fx, "+1", "accent", now);
  }
  s.food = spawnFood(s, lw, lh, obs);
}

export function stepSnake(
  st: MutRef<SnakeState | null>,
  grid: CharGrid,
  fx: FxState,
  reduced: boolean,
  obs: Obstacle[],
): void {
  // logical cells are 2 chars wide inside ║…║; height minus status + frame rows
  const lw = Math.floor((grid.cols - 2) / 2);
  const lh = grid.rows - 3;
  if (lw < 8 || lh < 6) return;
  const s = (st.current ??= freshSnake(lw, lh));
  if (s.paused || s.over) return;
  refit(s, lw, lh);
  s.tick += 1;

  const turn = s.queue.shift();
  if (turn && !(turn.x === -s.dir.x && turn.y === -s.dir.y)) s.dir = turn;

  const head = s.body[0];
  if (!head) return;
  const nx = head.x + s.dir.x;
  const ny = head.y + s.dir.y;

  // only the OUTER playfield frame and firewall nodes are lethal — topology node
  // borders are passable, so weaving through the boxes is the whole point
  if (nx < 0 || ny < 0 || nx >= lw || ny >= lh)
    return die(s, fx, "PACKET LOST — LEFT THE FABRIC", "LOST");
  if (s.nodes.some((n) => n.x === nx && n.y === ny))
    return die(s, fx, "FIREWALL BREACH — PACKET DROPPED", "BREACH");

  const eats = nx === s.food.x && ny === s.food.y;
  const now = Date.now();
  const inNode = obs.length > 0 ? rectIndex(obs, nx, ny) : -1;
  const entering = inNode >= 0 && s.insideNode !== inNode;
  const grow = eats || entering;
  // the tail cell vacates this tick unless the packet grows into it
  const trunk = grow ? s.body : s.body.slice(0, -1);
  if (trunk.some((c) => c.x === nx && c.y === ny))
    return die(s, fx, "LOOPBACK COLLISION — PACKET ATE ITSELF", "LOST");

  s.body.unshift({ x: nx, y: ny });

  // slipping INTO a node's rect breaches it — bonus point + flicker + a hard flash
  if (inNode >= 0) {
    s.breached[inNode] = now;
    if (entering) {
      s.insideNode = inNode;
      s.score += 1;
      impact(fx, "score", now);
    }
  } else {
    s.insideNode = -1;
  }

  if (!grow) s.body.pop();
  else if (eats) eatFood(s, fx, lw, lh, obs, now);
  bendAhead(s, fx, lw, lh, reduced);
}

// keyboard handler; handled keys stop propagation so the shell's own chords never fire
// while the trace is running.
export function snakeKeys(
  st: MutRef<SnakeState | null>,
  rerender: () => void,
  onExit: () => void,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || keyOwnedByWidget(e)) return;
    const k = e.key.toLowerCase();
    const dir = DIRS[k];
    let handled = true;
    if (dir) {
      const s = st.current;
      if (s && !s.over) {
        const last = s.queue.at(-1) ?? s.dir;
        if (!(dir.x === -last.x && dir.y === -last.y) && s.queue.length < 3) s.queue.push(dir);
        if (s.paused) {
          // steering resumes a held packet
          s.paused = false;
          rerender();
        }
      }
    } else if (k === "p") {
      const s = st.current;
      if (s && !s.over) {
        s.paused = !s.paused;
        rerender();
      }
    } else if (k === "r") {
      // reboot — fresh state materialises on the next render
      st.current = null;
      rerender();
    } else if (k === "q" || k === "escape") onExit();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}
