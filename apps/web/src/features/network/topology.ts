// Topology data model for the network-map view. Zones are described as data and
// rendered to unicode box art by renderTopology.ts — no hand-drawn constants.
// Phase 1 builds these Zone objects from the live engine + compose labels; for now
// SITE_ZONES encodes the demo fleet faithfully.

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
  /** Stack id passed to onJump when the zone is inspected. */
  jump: string;
  nodes: Node[];
  edges: Edge[];
  externals?: External[];
  notes?: SideNote[];
  /** Text of the ═══ boundary rail rendered under the diagram. */
  boundary?: string;
  crossLinks: CrossLink[];
}

/** A directed flow that CROSSES a zone boundary — drives the focus-linked highlighting and
 *  the BOUNDARIES rail. `from`/`to` are zone ids (or an external pseudo-id: internet / tailnet
 *  / vpn). `boundary` tags the kind of crossing so the rail can colour it. */
export interface CrossBoundary {
  from: string;
  to: string;
  via: string;
  boundary: "wan" | "tunnel" | "bridge" | "vpn";
}

// The inter-zone (and edge-of-world) flows for the demo stack. EDGE is the ingress hub
// (routes to everything); OBSERVABILITY is the telemetry sink (everything reports to it).
export const CROSS_BOUNDARIES: CrossBoundary[] = [
  { from: "internet", to: "edge", via: ":443 → gateway tunnel", boundary: "wan" },
  { from: "tailnet", to: "edge", via: "apps.example.internal → auth", boundary: "wan" },
  { from: "edge", to: "observ", via: "proxy routes dashboard:3000", boundary: "bridge" },
  { from: "edge", to: "media", via: "proxy :443 → media/catalog", boundary: "bridge" },
  { from: "edge", to: "data", via: "proxy routes app:8080", boundary: "bridge" },
  { from: "media", to: "observ", via: "collector tails stdout + ⌁", boundary: "bridge" },
  { from: "data", to: "observ", via: "⌁ metrics scraped", boundary: "bridge" },
  { from: "media", to: "vpn", via: "gateway sealed egress", boundary: "vpn" },
];

/** Zone ids linked to `zoneId` by any cross-boundary flow (either direction). */
export function linkedZones(zoneId: string): Set<string> {
  const out = new Set<string>();
  for (const b of CROSS_BOUNDARIES) {
    if (b.from === zoneId) out.add(b.to);
    else if (b.to === zoneId) out.add(b.from);
  }
  return out;
}

// ── The demo fleet, four zones ──────────────────────────────────────────────

export const SITE_ZONES: Zone[] = [
  {
    id: "edge",
    title: "EDGE · INGRESS",
    jump: "core",
    externals: [
      { text: "internet ──:443──", target: "tunnel" },
      { text: "tailnet · apps.example.internal ──", target: "auth" },
    ],
    nodes: [
      { id: "tunnel", label: "TUNNEL", sublabel: "profile: public" },
      { id: "proxy", label: "PROXY", sublabel: ":80 · :443", hangVolume: "proxy-data" },
      {
        id: "auth",
        label: "AUTH · verify",
        children: [{ id: "cache", label: "CACHE", sublabel: "session store" }],
      },
    ],
    edges: [
      { from: "tunnel", to: "proxy", label: "tunnel" },
      { from: "proxy", to: "auth", label: "auth" },
    ],
    boundary: "boundary: internet ⇢ homelab_default (bridge)",
    crossLinks: [
      { dir: "out", text: "ROUTES dashboard · app · media" },
      { dir: "in", text: "every public name terminates here" },
    ],
  },
  {
    id: "observ",
    title: "OBSERVABILITY",
    jump: "observ",
    nodes: [
      { id: "dashboard", label: "DASHBOARD", sublabel: "dashboards" },
      { id: "metrics", label: "METRICS", volumes: ["metrics-tsdb"] },
      { id: "logs", label: "LOGS ▤ data", row: 1 },
      { id: "collector", label: "COLLECTOR", row: 1 },
    ],
    edges: [
      { from: "dashboard", to: "metrics", label: "query" },
      { from: "dashboard", to: "logs", label: "logs" },
      { from: "collector", to: "logs", label: "ship" },
    ],
    notes: [
      { row: 0, lines: ["◀ cadvisor ⌁", "◀ node_exporter"] },
      { row: 1, lines: ["◀ all stdout"] },
    ],
    crossLinks: [
      { dir: "in", text: "EDGE proxy routes dashboard:3000" },
      { dir: "in", text: "ALL AREAS emit ⌁ + stdout" },
    ],
  },
  {
    id: "media",
    title: "MEDIA · VPN NETNS",
    jump: "media",
    nodes: [
      { id: "media", label: "MEDIA" },
      { id: "indexer", label: "INDEXER" },
      { id: "catalog", label: "CATALOG" },
      {
        id: "gateway",
        label: "VPN NETNS · gateway",
        sealed: true,
        row: 1,
        footer: "sealed egress → vpn",
        children: [{ id: "worker", label: "WORKER · no own IP" }],
      },
    ],
    edges: [
      { from: "media", to: "indexer" },
      { from: "catalog", to: "indexer" },
      { from: "media", to: "gateway", label: "grab" },
      { from: "catalog", to: "gateway", label: "grab" },
    ],
    notes: [{ row: 0, lines: ["▤ /data shared", "▤ per-unit cfg"] }],
    crossLinks: [
      { dir: "in", text: "EDGE requests via proxy" },
      { dir: "out", text: "OBSERV collector tails stdout" },
    ],
  },
  {
    id: "data",
    title: "DATA",
    jump: "data",
    nodes: [
      {
        id: "app",
        label: "APP",
        sublabel: ":8080 · oidc",
        caption: "profile: data",
      },
      {
        id: "rack",
        label: "DATA RACK",
        titled: true,
        childStyle: "list",
        children: [
          { id: "db", label: "DB", volumes: ["db-data"] },
          { id: "queue", label: "QUEUE", sublabel: "queue" },
          { id: "warehouse", label: "WAREHOUSE", volumes: ["warehouse-data"] },
        ],
      },
    ],
    edges: [{ from: "app", to: "rack", label: "write" }],
    crossLinks: [
      { dir: "in", text: "EDGE proxy routes app.example.internal" },
      { dir: "out", text: "OBSERV ⌁" },
    ],
  },
];
