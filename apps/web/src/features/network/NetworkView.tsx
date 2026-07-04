import { useCallback, useEffect, useMemo, useState } from "react";
import { Box } from "../../ui/box.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import type { Container } from "../../data/mock.ts";
import { Snake } from "../games/Snake.tsx";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { linkedNetworks, networkToZone, sharedLinks, zoneRenderWidth } from "./topology.ts";
import { renderZone } from "./renderTopology.ts";
import { locateHotspots, type NodeHotspot } from "./nodes.ts";
import "./network.css";

// Full-pane topology of the REAL docker networks (RPC `networks.list`, polled). Each network is a
// focusable area (j/k move); every member container is a hotspot — hover/focus highlights it, click
// filters the fleet to that unit. ↔ marks networks that share a container; ⊘ marks internal nets.
// Networks with more than COLLAPSE_AT members (e.g. the compose <project>_default, ~40 units) render
// as a one-line summary by default: ↵ / clicking toggles expand; [I] / the title still jump-to-fleet.
interface NetCard {
  id: string;
  name: string;
  /** Fleet filter token passed to onJump when the network / a unit is inspected. */
  jump: string;
  internal: boolean;
  /** Member-container count (shown in the collapsed summary). */
  count: number;
  /** Large enough to collapse to a one-line summary by default. */
  collapsible: boolean;
  /** Whether the full box-art is currently shown (always true for small nets). */
  expanded: boolean;
  art: string;
  links: string;
  hotspots: NodeHotspot[];
}

const cap = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// docker's default networks — always present, always empty in this stack, just clutter
const BUILTIN_NETS = new Set(["bridge", "host", "none"]);

// Networks larger than this collapse to a one-line summary by default (the compose default net
// carries every service, so its full grid is ~40 boxes of noise).
const COLLAPSE_AT = 10;

export function NetworkView(props: {
  live: boolean;
  onJump: (stack: string) => void;
  // Accepted for call-site compatibility (MainView passes the fleet + a detail opener); the network
  // map filters the fleet via onJump rather than opening a container's detail.
  containers: Container[];
  onOpen: (c: Container) => void;
}) {
  const { live, onJump } = props;
  const [sel, setSel] = useState(0);
  const [snake, setSnake] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  // ids of large networks the user has expanded (all large nets start collapsed)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { data } = useRpcQuery("networks.list", {}, { pollMs: 5000 });
  // hide docker's built-in bridge/host/none — they're always-present, empty, and pure noise here
  const networks = (data?.networks ?? []).filter((n) => !BUILTIN_NETS.has(n.name));

  // networks linked by a shared container — the real-data analog of the old cross-boundary flows
  const links = useMemo(() => sharedLinks(networks), [networks]);
  const internalIds = useMemo(
    () => new Set(networks.filter((n) => n.internal).map((n) => n.id)),
    [networks],
  );
  // render each network to box art at its cell width (first card spans the full pane); large nets
  // stay collapsed (no art built) until expanded
  const cards = useMemo<NetCard[]>(
    () =>
      networks.map((net, i) => {
        const count = net.containers.length;
        const collapsible = count > COLLAPSE_AT;
        const isExpanded = !collapsible || expanded.has(net.id);
        const base = { id: net.id, name: net.name, jump: net.name, internal: net.internal, count };
        if (!isExpanded) {
          return { ...base, collapsible, expanded: false, art: "", links: "", hotspots: [] };
        }
        const w = zoneRenderWidth(i);
        const zone = networkToZone(net, links, w);
        const { art, links: linksLine } = renderZone(zone, w);
        return {
          ...base,
          collapsible,
          expanded: true,
          art,
          links: linksLine,
          hotspots: locateHotspots(zone, art),
        };
      }),
    [networks, links, expanded],
  );

  const safeSel = Math.max(0, Math.min(sel, cards.length - 1));
  const current = cards[safeSel] ?? null;
  // networks the focused area shares containers with — drives the dim/highlight + rail
  const linked = current ? linkedNetworks(current.id, links) : new Set<string>();
  const focusLinks = current ? links.filter((l) => l.a === current.id || l.b === current.id) : [];

  useEffect(() => {
    if (!live || snake) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "ArrowDown" || e.key === "j") setSel((s) => Math.min(cards.length - 1, s + 1));
      else if (e.key === "ArrowUp" || e.key === "k") setSel((s) => Math.max(0, s - 1));
      else if (e.key === "Enter" && current) {
        // ↵ toggles collapse on large nets; on small nets it inspects (jump-to-fleet), as before
        if (current.collapsible) toggleExpand(current.id);
        else onJump(current.jump);
      } else if ((e.key === "i" || e.key === "I") && current) onJump(current.jump);
      else if (e.key === "g") setSnake(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, snake, current, onJump, cards.length, toggleExpand]);

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

  // ↵ means EXPAND/COLLAPSE on large nets, INSPECT on small ones; collapsible nets get a
  // distinct [I] INSPECT so jump-to-fleet stays reachable while ↵ drives collapse.
  const enterLabel = current
    ? current.collapsible
      ? current.expanded
        ? "COLLAPSE"
        : "EXPAND"
      : `INSPECT ${current.name}`
    : "";
  const runEnter = () => {
    if (!current) return;
    if (current.collapsible) toggleExpand(current.id);
    else onJump(current.jump);
  };

  return (
    <div className="network">
      <ActionBar
        lead={<span className="ink--dim">{networks.length} NETWORKS</span>}
        items={[
          { key: "J/K", label: "AREA" },
          { key: "↵", label: enterLabel, onRun: runEnter },
          ...(current?.collapsible
            ? [{ key: "I", label: `INSPECT ${current.name}`, onRun: () => onJump(current.jump) }]
            : []),
          { key: "G", label: "SNAKE.SYS", onRun: () => setSnake(true) },
        ]}
      />
      <div className="network__legend">
        {hover ? (
          <span className="ink--accent">▸ {hover} · click to filter fleet</span>
        ) : current ? (
          <span>
            <b className="ink--accent">{current.name}</b>
            {current.internal ? <span className="ink--warn"> · ⊘ internal</span> : null} shares with{" "}
            {focusLinks.length === 0 ? (
              <span className="ink--dim">— nothing —</span>
            ) : (
              focusLinks.map((l, i) => {
                const other = l.a === current.id ? l.bName : l.aName;
                return (
                  <span key={`${l.a}-${l.b}`}>
                    {i > 0 ? " · " : ""}↔ <b>{other}</b>{" "}
                    <span className="ink--dim">({l.via.join(", ")})</span>
                  </span>
                );
              })
            )}
          </span>
        ) : (
          "⊘ INTERNAL · ↔ SHARES CONTAINERS · CLICK A UNIT TO FILTER THE FLEET"
        )}
      </div>
      <div className="network__zones">
        {cards.map((z, i) => {
          const isFocus = i === safeSel;
          const isLinked = linked.has(z.id);
          const cls = [
            "netzone",
            z.internal ? "netzone--internal" : "",
            live && !isFocus && !isLinked ? "netzone--dim" : "",
            live && isLinked ? "netzone--linked" : "",
          ];
          const collapseAction =
            z.collapsible && z.expanded ? (
              <button className="netzone__collapse" onClick={() => toggleExpand(z.id)}>
                ↵ COLLAPSE
              </button>
            ) : null;
          return (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover previews the zone cursor; keyboard nav + the title button carry the real affordances
            <div className={cls.join(" ")} key={z.id} onMouseEnter={() => setSel(i)}>
              <Box
                title={
                  <button className="netzone__title" onClick={() => onJump(z.jump)}>
                    {z.name} {z.internal ? "⊘" : ""} {isLinked ? "⇄" : "▸"}
                  </button>
                }
                actions={collapseAction}
                focus={live && i === safeSel}
                fill
              >
                {z.expanded ? (
                  <>
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
                          aria-label={`filter fleet to ${h.id}`}
                          onMouseEnter={() => setHover(h.id)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(h.id)}
                          onBlur={() => setHover(null)}
                          onClick={() => onJump(h.id)}
                        />
                      ))}
                    </div>
                    <div className="netzone__spring" />
                    <div className="netzone__links">{z.links}</div>
                  </>
                ) : (
                  <div className="netzone__collapsed">
                    <button className="netzone__expand" onClick={() => toggleExpand(z.id)}>
                      ▤ {z.count} units · [↵ EXPAND]
                    </button>
                    <button className="netzone__inspect" onClick={() => onJump(z.jump)}>
                      [INSPECT ▸]
                    </button>
                  </div>
                )}
              </Box>
            </div>
          );
        })}
        {cards.length === 0 ? (
          <div className="netzone__empty">{data ? "NO DOCKER NETWORKS" : "SCANNING NETWORKS…"}</div>
        ) : null}
      </div>
      <div className="network__boundaries">
        <span className="network__blabel">BOUNDARIES</span>
        {links.length === 0 ? (
          <span className="nbedge nbedge--off">— no shared containers —</span>
        ) : (
          links.map((l) => {
            const on = current !== null && (l.a === current.id || l.b === current.id);
            const isInternal = internalIds.has(l.a) || internalIds.has(l.b);
            const cls = [
              "nbedge",
              isInternal ? "nbedge--internal" : "",
              on ? "nbedge--on" : "nbedge--off",
            ];
            return (
              <span key={`${l.a}-${l.b}`} className={cls.join(" ")} title={l.via.join(", ")}>
                {cap(l.aName).toUpperCase()}═▶{cap(l.bName).toUpperCase()}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
