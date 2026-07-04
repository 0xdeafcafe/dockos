import { useEffect, useState } from "react";
import { Box } from "../../ui/box.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import type { Container } from "../../data/mock.ts";
import { Snake } from "../games/Snake.tsx";
import { CROSS_BOUNDARIES, SITE_ZONES, linkedZones } from "./topology.ts";
import { renderZone } from "./renderTopology.ts";
import { locateHotspots } from "./nodes.ts";
import type { NodeHotspot } from "./nodes.ts";
import "./network.css";

// short caps for the boundary rail — zone ids + edge-of-world pseudo-nodes
const AREA_LABEL: Record<string, string> = {
  edge: "EDGE",
  observ: "OBSERV",
  media: "MEDIA",
  data: "DATA",
  internet: "INTERNET",
  tailnet: "TAILNET",
  vpn: "VPN",
};
const areaLabel = (id: string) => AREA_LABEL[id] ?? id.toUpperCase();

// Full-pane topology, GENERATED from topology data (topology.ts → renderTopology.ts).
// Each AREA is a focusable sub-pane (j/k move, ↵ inspects); and every unit box inside is
// itself a hotspot — hover/focus highlights it, click opens that container's detail (or
// filters the fleet to it when the node has no unit of its own). ⇢/⇠ = cross-area links.
interface Zone {
  id: string;
  title: string;
  jump: string;
  art: string;
  links: string;
  hotspots: NodeHotspot[];
}

// EDGE spans the full pane width (top row); the other three share a 2-column grid, so they
// must render at ~half width or their art overflows the cell and clips mid-diagram.
const FULL_W = 92;
const HALF_W = 66;
const ZONES: Zone[] = SITE_ZONES.map((z) => {
  const { art, links } = renderZone(z, z.id === "edge" ? FULL_W : HALF_W);
  return { id: z.id, title: z.title, jump: z.jump, art, links, hotspots: locateHotspots(z, art) };
});

export function NetworkView({
  live,
  onJump,
  containers,
  onOpen,
}: {
  live: boolean;
  onJump: (stack: string) => void;
  containers: Container[];
  onOpen: (c: Container) => void;
}) {
  const [sel, setSel] = useState(0);
  const [snake, setSnake] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const current = ZONES[sel];
  // zones the focused area exchanges traffic with — drives the dim/highlight + rail
  const linked = current ? linkedZones(current.id) : new Set<string>();
  // the focused area's own cross-boundary flows, surfaced with their `via` detail
  const focusEdges = current
    ? CROSS_BOUNDARIES.filter((b) => b.from === current.id || b.to === current.id)
    : [];

  const openNode = (zone: Zone, id: string) => {
    const c = containers.find((x) => x.name === id);
    if (c) onOpen(c);
    else onJump(zone.jump);
  };

  useEffect(() => {
    if (!live || snake) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "ArrowDown" || e.key === "j") setSel((s) => Math.min(ZONES.length - 1, s + 1));
      else if (e.key === "ArrowUp" || e.key === "k") setSel((s) => Math.max(0, s - 1));
      else if (e.key === "Enter" && current) onJump(current.jump);
      else if (e.key === "g") setSnake(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, snake, current, onJump]);

  // flatten the tube while SNAKE runs — the barrel filter re-runs per game frame otherwise
  useEffect(() => {
    const root = document.documentElement;
    if (snake) root.dataset.crtGame = "1";
    else delete root.dataset.crtGame;
    return () => {
      delete root.dataset.crtGame;
    };
  }, [snake]);

  if (snake) {
    return (
      <div className="network">
        <Snake active={live} onExit={() => setSnake(false)} />
      </div>
    );
  }

  return (
    <div className="network">
      <ActionBar
        lead={<span className="ink--dim">6 NETWORKS</span>}
        items={[
          { key: "J/K", label: "AREA" },
          {
            key: "↵",
            label: `INSPECT ${current?.title ?? ""}`,
            onRun: () => current && onJump(current.jump),
          },
          { key: "G", label: "SNAKE.SYS", onRun: () => setSnake(true) },
        ]}
      />
      <div className="network__legend">
        {hover ? (
          <span className="ink--accent">▸ {hover} · click to open unit</span>
        ) : current ? (
          <span>
            <b className="ink--accent">{current.title}</b> crosses to{" "}
            {focusEdges.length === 0 ? (
              <span className="ink--dim">— nothing —</span>
            ) : (
              focusEdges.map((b, i) => {
                const other = b.from === current.id ? b.to : b.from;
                const dir = b.from === current.id ? "⇢" : "⇠";
                return (
                  <span key={`${b.from}-${b.to}`}>
                    {i > 0 ? " · " : ""}
                    {dir} <b>{areaLabel(other)}</b> <span className="ink--dim">({b.via})</span>
                  </span>
                );
              })
            )}
          </span>
        ) : (
          "═ BOUNDARY · ▤ SHARED VOLUME · ⇢ OUTBOUND · ⇠ INBOUND · CLICK A UNIT TO OPEN"
        )}
      </div>
      <div className="network__zones">
        {ZONES.map((z, i) => {
          const isFocus = i === sel;
          const isLinked = linked.has(z.id);
          const cls = [
            "netzone",
            live && !isFocus && !isLinked ? "netzone--dim" : "",
            live && isLinked ? "netzone--linked" : "",
          ];
          return (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover previews the zone cursor; keyboard nav + the title button carry the real affordances
            <div className={cls.join(" ")} key={z.jump} onMouseEnter={() => setSel(i)}>
            <Box
              title={
                <button className="netzone__title" onClick={() => onJump(z.jump)}>
                  {z.title} {isLinked ? "⇄" : "▸"}
                </button>
              }
              focus={live && i === sel}
              fill
            >
              <div className="netzone__art-wrap">
                <pre className="netzone__art">{z.art}</pre>
                {z.hotspots.map((h) => (
                  <button
                    key={h.id}
                    className="netnode"
                    style={{
                      top: `${h.row}lh`,
                      left: `${h.col}ch`,
                      width: `${h.width}ch`,
                    }}
                    aria-label={`open ${h.id}`}
                    onMouseEnter={() => setHover(h.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(h.id)}
                    onBlur={() => setHover(null)}
                    onClick={() => openNode(z, h.id)}
                  />
                ))}
              </div>
              <div className="netzone__spring" />
              <div className="netzone__links">{z.links}</div>
            </Box>
            </div>
          );
        })}
      </div>
      <div className="network__boundaries">
        <span className="network__blabel">BOUNDARIES</span>
        {CROSS_BOUNDARIES.map((b) => {
          const on = current && (b.from === current.id || b.to === current.id);
          return (
            <span
              key={`${b.from}-${b.to}`}
              className={`nbedge nbedge--${b.boundary} ${on ? "nbedge--on" : "nbedge--off"}`}
              title={b.via}
            >
              {areaLabel(b.from)}═▶{areaLabel(b.to)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
