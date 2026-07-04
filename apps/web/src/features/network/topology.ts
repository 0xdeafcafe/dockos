// Topology data model for the network-map view. Zones are described as data and
// rendered to unicode box art by renderTopology.ts — no hand-drawn constants.
// The data source is the live engine via the `networks.list` RPC: each docker
// network becomes a Zone whose nodes are its member containers (see networkToZone).

import type { Network } from "@dockos/contract";

/** A service box (or a grouped dependency when nested via `children`). */
export interface Node {
  id: string;
  label: string;
  /** Second line inside the box, centered (e.g. ":80 · :443", "dashboards"). */
  sublabel?: string;
  /** Volumes rendered as centered "▤ name" lines inside the box. */
  volumes?: string[];
  /** One volume hung below the box: ┬ on the bottom border, "▤ name" underneath. */
  hangVolume?: string;
  /** Plain caption line below the box (e.g. "profile: data"). */
  caption?: string;
  /** Grouped dependencies rendered inside this box. */
  children?: Node[];
  /**
   * How children render: "framed" gives each its own ┌─ TITLE ─┐ mini-frame
   * (cache inside auth); "list" renders one line per child — label column,
   * then ▤ volume or (sublabel) — the data-rack style.
   */
  childStyle?: "framed" | "list";
  /** Double-line ╔═╗ vault (sealed namespace). Incoming edges pierce the top rail with ▼. */
  sealed?: boolean;
  /** Text embedded in a sealed vault's bottom rail (e.g. "sealed egress → vpn"). */
  footer?: string;
  /** Render the label in the top border: ┌─ LABEL ───┐ (the DATA RACK style). */
  titled?: boolean;
  /** Layout row, top to bottom. Defaults to 0. Boxes in a row lay out left→right. */
  row?: number;
  /** Minimum outer width in cells. */
  minWidth?: number;
  /** Presentational-only box (e.g. an "· no containers ·" placeholder): no hotspot. */
  nonUnit?: boolean;
}

/**
 * A connection between two nodes of the same zone. Same-row adjacent nodes get a
 * horizontal ──▶/◀── connector (label on the border line above the arrow);
 * nodes on consecutive rows get a ┬ │ ▼ vertical drop from the source's center.
 */
export interface Edge {
  from: string;
  to: string;
  label?: string;
  /** Arrowhead direction: "fwd" points at `to` (default), "rev" points back at `from`. */
  dir?: "fwd" | "rev";
}

/** An ingress arrow from outside the zone (internet / tailnet), dropped onto `target`. */
export interface External {
  /** Lead-in text including its own dashes, e.g. "internet ──:443──". */
  text: string;
  /** Node id the ▼ drops onto. */
  target: string;
}

/** Free-form annotation lines placed to the right of a row's last box. Lines that
 *  start with ◀ attach flush to the border (inbound arrows); others get a 2ch gap. */
export interface SideNote {
  row: number;
  lines: string[];
}

/** One entry of the ⇢/⇠ cross-zone footer line. */
export interface CrossLink {
  dir: "in" | "out";
  text: string;
}

export interface Zone {
  id: string;
  title: string;
  /** Stack/filter token passed to onJump when the zone is inspected. */
  jump: string;
  nodes: Node[];
  edges: Edge[];
  externals?: External[];
  notes?: SideNote[];
  /** Text of the ═══ boundary rail rendered under the diagram. */
  boundary?: string;
  crossLinks: CrossLink[];
}

// ── Live-data mapping: networks.list → renderable zones ─────────────────────────
//
// EDGE spans the full pane width (its grid cell is `grid-column: 1 / -1`); the rest
// share a 2-column grid, so they render at ~half width or the art overflows the cell.
export const FULL_W = 92;
export const HALF_W = 66;
/** Render (and row-pack) width for the zone at `index`: the first card is full-width. */
export const zoneRenderWidth = (index: number): number => (index === 0 ? FULL_W : HALF_W);

/** A shared-container link between two networks — the real-data analog of the old
 *  hand-authored cross-boundary flows. Drives focus highlighting + the BOUNDARIES rail. */
export interface NetLink {
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** Container names present in BOTH networks. */
  via: string[];
}

/** Every pair of networks that share at least one container. A compose project's
 *  `<project>_default` net holds every service, so it trivially shares containers with
 *  all of them — that's noise, not topology, so those nets produce no links. */
export function sharedLinks(networks: Network[]): NetLink[] {
  const linkable = networks.filter((n) => !n.name.endsWith("_default"));
  const out: NetLink[] = [];
  for (let i = 0; i < linkable.length; i += 1) {
    for (let j = i + 1; j < linkable.length; j += 1) {
      const a = linkable[i]!;
      const b = linkable[j]!;
      const bset = new Set(b.containers);
      const via = a.containers.filter((c) => bset.has(c));
      if (via.length > 0) out.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, via });
    }
  }
  return out;
}

/** Ids of networks linked to `id` by any shared-container flow (either direction). */
export function linkedNetworks(id: string, links: NetLink[]): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (l.a === id) out.add(l.b);
    else if (l.b === id) out.add(l.a);
  }
  return out;
}

// Layout constants mirrored from renderTopology.ts so row-packing lands boxes inside
// the render width. Box outer width ≈ label + 6 (layoutNode: iw = label + 4, +2 borders);
// unlabelled edges leave a 3-cell gap; the diagram is inset by a 1-cell margin.
const MARGIN = 1;
const PLAIN_GAP = 3;
const boxWidth = (label: string) => label.length + 6;

// Pack container boxes into left→right rows that fit `width`; overflow wraps to a new
// row. With no edges between them the renderer simply stacks the rows.
function packRows(names: string[], width: number): Node[] {
  const nodes: Node[] = [];
  let row = 0;
  let x = MARGIN;
  for (const name of names) {
    const w = boxWidth(name);
    if (x > MARGIN && x + PLAIN_GAP + w > width) {
      row += 1;
      x = MARGIN;
    }
    const gap = x === MARGIN ? 0 : PLAIN_GAP;
    nodes.push({ id: name, label: name, row });
    x += gap + w;
  }
  return nodes;
}

/** Build the renderable Zone for one docker network. `width` is the pane cell width
 *  the zone will be rendered at (so container boxes wrap instead of clipping). */
export function networkToZone(net: Network, links: NetLink[], width: number): Zone {
  const nodes =
    net.containers.length === 0
      ? [{ id: `${net.id}:empty`, label: "· no containers ·", nonUnit: true }]
      : packRows([...net.containers].toSorted(), width);

  const crossLinks: CrossLink[] = links
    .filter((l) => l.a === net.id || l.b === net.id)
    .map((l) => ({ dir: "out", text: `↔ ${l.a === net.id ? l.bName : l.aName} · ${l.via.join(", ")}` }));

  const boundary = net.internal
    ? `⊘ internal · driver: ${net.driver} · no external route`
    : `driver: ${net.driver} · scope: ${net.scope}`;

  return { id: net.id, title: net.name, jump: net.name, nodes, edges: [], crossLinks, boundary };
}
