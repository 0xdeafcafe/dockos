// Pure, deterministic layout/render engine: Zone data → unicode box art in the
// TUI's visual language (┌─┐ boxes, nested frames, ╔═╗ vaults, ▤ volumes, ──▶
// edges, ═══ rails). Opinionated row layout, not general graph layout: boxes go
// left→right with label-sized gaps; vertical edges drop ┬ │ ▼ onto the next row.
// Built for 2–6 nodes per zone with one nesting level.

import type { Edge, Node, Zone } from "./topology.ts";

// MARGIN: leading space off the pane border · PLAIN_GAP: gap for unlabelled edges
const MARGIN = 1;
const PLAIN_GAP = 3;

function fill(ch: string, n: number): string {
  return n > 0 ? ch.repeat(n) : "";
}

function center(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  return fill(" ", left) + text + fill(" ", pad - left);
}

// ── canvas: a sparse char grid so connectors can overlay box borders ─────────

type Canvas = string[][];

function put(canvas: Canvas, y: number, x: number, text: string): void {
  while (canvas.length <= y) canvas.push([]);
  const line = canvas[y]!;
  for (let i = 0; i < text.length; i += 1) {
    const cx = x + i;
    if (cx < 0) continue;
    while (line.length < cx) line.push(" ");
    line[cx] = text[i]!;
  }
}

function blit(canvas: Canvas, y: number, x: number, lines: string[]): void {
  for (let i = 0; i < lines.length; i += 1) put(canvas, y + i, x, lines[i] ?? "");
}

// ── box rendering ─────────────────────────────────────────────────────────────

// Mini-frame for a framed child: ┌─ LABEL ────┐ / │ sublabel │ / └────┘.
function frameChild(child: Node, width: number): string[] {
  const top = "┌─ " + child.label + " " + fill("─", width - child.label.length - 5) + "┐";
  const mid = child.sublabel === undefined ? [] : ["│ " + child.sublabel.padEnd(width - 3) + "│"];
  return [top, ...mid, "└" + fill("─", width - 2) + "┘"];
}

function framedChildNaturalWidth(children: Node[]): number {
  return Math.max(
    ...children.map((c) => Math.max(c.label.length + 6, (c.sublabel?.length ?? 0) + 4)),
  );
}

function listSuffix(child: Node): string {
  const vol = child.volumes?.[0];
  if (vol !== undefined) return `▤ ${vol}`;
  if (child.sublabel !== undefined) return `(${child.sublabel})`;
  return "";
}

// One line per child, DATA RACK style: LABEL column, then ▤ volume or (sublabel).
function listChildLines(children: Node[]): string[] {
  const labelCol = Math.max(...children.map((c) => c.label.length)) + 2;
  return children.map((c) => (c.label.padEnd(labelCol) + listSuffix(c)).trimEnd());
}

function layoutVault(node: Node, widthOverride: number | undefined): string[] {
  const children = node.children ?? [];
  let iw = node.label.length + 2;
  if (children.length > 0) iw = Math.max(iw, framedChildNaturalWidth(children) + 4);
  if (node.footer !== undefined) iw = Math.max(iw, node.footer.length + 4);
  if (node.minWidth !== undefined) iw = Math.max(iw, node.minWidth - 2);
  if (widthOverride !== undefined) iw = Math.max(iw, widthOverride - 2);
  const cw = iw - 4;
  const body = children.flatMap((c) => frameChild(c, cw)).map((l) => "║  " + l.padEnd(cw) + "  ║");
  const footer = node.footer === undefined ? "" : ` ${node.footer} `;
  const left = Math.floor((iw - footer.length) / 2);
  return [
    "╔" + fill("═", iw) + "╗",
    "║ " + node.label.padEnd(iw - 1) + "║",
    ...body,
    "╚" + fill("═", left) + footer + fill("═", iw - left - footer.length) + "╝",
  ];
}

// Render one node to equal-width lines. `widthOverride` stretches the box (outer width).
function layoutNode(node: Node, widthOverride?: number): string[] {
  if (node.sealed) return layoutVault(node, widthOverride);
  const children = node.children ?? [];
  const framed = (node.childStyle ?? "framed") === "framed";
  const listLines = framed || children.length === 0 ? [] : listChildLines(children);
  let iw = node.label.length + 4;
  if (node.sublabel !== undefined) iw = Math.max(iw, node.sublabel.length + 4);
  for (const v of node.volumes ?? []) iw = Math.max(iw, v.length + 6);
  if (framed && children.length > 0) iw = Math.max(iw, framedChildNaturalWidth(children) + 3);
  for (const l of listLines) iw = Math.max(iw, l.length + 3);
  if (node.minWidth !== undefined) iw = Math.max(iw, node.minWidth - 2);
  if (widthOverride !== undefined) iw = Math.max(iw, widthOverride - 2);
  const cw = iw - 3;
  const head = node.titled
    ? ["┌─ " + node.label + " " + fill("─", iw - node.label.length - 3) + "┐"]
    : ["┌" + fill("─", iw) + "┐", "│" + center(node.label, iw) + "│"];
  const sub = node.sublabel === undefined ? [] : ["│" + center(node.sublabel, iw) + "│"];
  const vols = (node.volumes ?? []).map((v) => "│" + center(`▤ ${v}`, iw) + "│");
  const inner = framed ? children.flatMap((c) => frameChild(c, cw)) : listLines;
  const body = inner.map((l) => "│  " + l.padEnd(cw) + " │");
  return [...head, ...sub, ...vols, ...body, "└" + fill("─", iw) + "┘"];
}

// ── zone layout ───────────────────────────────────────────────────────────────

interface Placed {
  node: Node;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Drop {
  edge: Edge;
  col: number;
  src: Placed;
}

function centerCol(p: Placed): number {
  return p.x + Math.floor((p.w - 1) / 2);
}

function edgeBetween(zone: Zone, a: string, b: string): Edge | undefined {
  return zone.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

// Same-row connector: label on the border line, ──▶/◀── on the label line below.
function drawHEdge(canvas: Canvas, edge: Edge, left: Placed, right: Placed): void {
  const gapStart = left.x + left.w;
  const gap = right.x - gapStart;
  if (gap <= 0) return;
  const pointsAt = edge.dir === "rev" ? edge.from : edge.to;
  const pointsRight = pointsAt === right.node.id;
  if (edge.label === undefined) {
    const body = fill("─", gap - 1);
    put(canvas, left.y + 1, gapStart, pointsRight ? `${body}▶` : `◀${body}`);
  } else {
    put(canvas, left.y, gapStart + Math.floor((gap - edge.label.length) / 2), edge.label);
    const body = fill("─", gap - 3);
    put(canvas, left.y + 1, gapStart, pointsRight ? ` ${body}▶ ` : ` ◀${body} `);
  }
}

// Vertical edges landing on the row that starts at `y`.
function dropsInto(zone: Zone, placed: Map<string, Placed>, rowNodes: Node[]): Drop[] {
  return zone.edges.flatMap((e) => {
    const src = placed.get(e.from);
    if (!src || !rowNodes.some((n) => n.id === e.to)) return [];
    return [{ edge: e, col: centerCol(src), src }];
  });
}

// ┬ pierces the source's bottom border, │ + label run down the gap; a normal
// target gets ▼ on its own line while a vault's ▼ pierces its ═ top rail (later).
function drawDrops(canvas: Canvas, drops: Drop[], y: number, sealedTarget: boolean): number {
  for (const d of drops) {
    put(canvas, d.src.y + d.src.h - 1, d.col, "┬");
    for (let yy = d.src.y + d.src.h; yy < y; yy += 1) put(canvas, yy, d.col, "│");
    put(canvas, y, d.col, d.edge.label === undefined ? "│" : `│ ${d.edge.label}`);
  }
  if (sealedTarget) return y + 1;
  for (const d of drops) put(canvas, y + 1, d.col, "▼");
  return y + 2;
}

function placeRowBoxes(
  zone: Zone,
  canvas: Canvas,
  rowNodes: Node[],
  drops: Drop[],
  y: number,
): Placed[] {
  const maxDrop = drops.length > 0 ? Math.max(...drops.map((d) => d.col)) : 0;
  const rowPlaced: Placed[] = [];
  let x = MARGIN;
  for (const n of rowNodes) {
    const prev = rowPlaced.at(-1);
    if (prev) {
      const e = edgeBetween(zone, prev.node.id, n.id);
      x += e?.label === undefined ? PLAIN_GAP : e.label.length + 4;
    }
    let widthOverride: number | undefined;
    if (n.sealed && rowNodes.length === 1 && drops.length > 0) {
      // the vault rail runs well past the last incoming ▼
      widthOverride = maxDrop - x + 7;
    }
    const lines = layoutNode(n, widthOverride);
    const p: Placed = { node: n, x, y, w: lines[0]?.length ?? 0, h: lines.length };
    rowPlaced.push(p);
    blit(canvas, y, x, lines);
    x += p.w;
  }
  return rowPlaced;
}

// Horizontal edges, hanging volumes, captions and side notes; returns row height.
function decorateRow(
  canvas: Canvas,
  zone: Zone,
  rowPlaced: Placed[],
  row: number,
  y: number,
): number {
  for (let i = 1; i < rowPlaced.length; i += 1) {
    const left = rowPlaced[i - 1]!;
    const right = rowPlaced[i]!;
    const e = edgeBetween(zone, left.node.id, right.node.id);
    if (e) drawHEdge(canvas, e, left, right);
  }
  let rowH = Math.max(...rowPlaced.map((p) => p.h));
  for (const p of rowPlaced) {
    if (p.node.hangVolume !== undefined) {
      const c = centerCol(p);
      put(canvas, p.y + p.h - 1, c, "┬");
      put(canvas, p.y + p.h, c, `▤ ${p.node.hangVolume}`);
      rowH = Math.max(rowH, p.h + 1);
    }
    if (p.node.caption !== undefined) {
      const cx = p.x + Math.max(0, Math.floor((p.w - p.node.caption.length) / 2));
      put(canvas, p.y + p.h, cx, p.node.caption);
      rowH = Math.max(rowH, p.h + 1);
    }
  }
  // side notes sit right of the row's last box; ◀ lines attach flush to the border
  const rightEdge = Math.max(...rowPlaced.map((p) => p.x + p.w));
  for (const note of zone.notes ?? []) {
    if (note.row !== row) continue;
    for (let i = 0; i < note.lines.length; i += 1) {
      const line = note.lines[i] ?? "";
      put(canvas, y + 1 + i, rightEdge + (line.startsWith("◀") ? 0 : 2), line);
    }
  }
  return rowH;
}

// Ingress arrows above the first row: text ──┐ with ▼ dropping onto the target box.
function drawExternals(canvas: Canvas, zone: Zone, placed: Map<string, Placed>): void {
  for (const ext of zone.externals ?? []) {
    const target = placed.get(ext.target);
    if (!target) continue;
    // ▼ lands at the box's center, pushed right if the lead-in text needs room
    const col = Math.min(
      Math.max(centerCol(target), MARGIN + ext.text.length),
      target.x + target.w - 3,
    );
    put(canvas, 0, col - ext.text.length, ext.text + "┐");
    put(canvas, 1, col, "▼");
  }
}

function drawBoundary(canvas: Canvas, boundary: string, y: number, maxWidth: number): void {
  const artWidth = Math.min(
    maxWidth,
    Math.max(...canvas.map((l) => l.length), MARGIN + boundary.length + 9),
  );
  const lead = `═══ ${boundary} `;
  put(canvas, y, MARGIN, lead + fill("═", Math.max(4, artWidth - MARGIN - lead.length)));
}

// Render one zone. Every output line is ≤ maxWidth chars and box edges align.
export function renderZone(zone: Zone, maxWidth: number): { art: string; links: string } {
  const canvas: Canvas = [];
  const placed = new Map<string, Placed>();
  const rowIndices = [...new Set(zone.nodes.map((n) => n.row ?? 0))].toSorted((a, b) => a - b);
  // reserve the external-ingress lines above the first row
  let y = (zone.externals?.length ?? 0) > 0 ? 2 : 0;
  for (const [ri, r] of rowIndices.entries()) {
    const rowNodes = zone.nodes.filter((n) => (n.row ?? 0) === r);
    const drops = dropsInto(zone, placed, rowNodes);
    const sealedTarget = rowNodes.some((n) => n.sealed);
    if (ri > 0 && drops.length > 0) y = drawDrops(canvas, drops, y, sealedTarget);
    const rowPlaced = placeRowBoxes(zone, canvas, rowNodes, drops, y);
    for (const p of rowPlaced) placed.set(p.node.id, p);
    if (sealedTarget) for (const d of drops) put(canvas, y, d.col, "▼");
    y += decorateRow(canvas, zone, rowPlaced, r, y);
  }
  drawExternals(canvas, zone, placed);
  if (zone.boundary !== undefined) drawBoundary(canvas, zone.boundary, y, maxWidth);
  const art = canvas.map((line) => line.join("").trimEnd().slice(0, maxWidth)).join("\n");
  return { art, links: renderLinks(zone).slice(0, maxWidth) };
}

// The one-line ⇢/⇠ cross-zone footer.
export function renderLinks(zone: Zone): string {
  return zone.crossLinks.map((l) => `${l.dir === "out" ? "⇢" : "⇠"} ${l.text}`).join("   ");
}
