import type { Node, Zone } from "./topology.ts";

// A clickable region over a node's label in the rendered ASCII art. The renderer emits a
// flat monospace string; we find each node's label in it and map (line,col) → cell coords
// so an overlay button can sit exactly on the box in the grid.
export interface NodeHotspot {
  id: string;
  label: string;
  row: number;
  col: number;
  width: number;
}

function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => (n.children ? [n, ...flatten(n.children)] : [n]));
}

// nodes whose id is a real fleet container (others — tunnel, collector, the DATA RACK
// wrapper — have no unit of their own and fall back to inspecting the zone)
const NON_UNIT = new Set(["rack"]);

export function locateHotspots(zone: Zone, art: string): NodeHotspot[] {
  const lines = art.split("\n");
  const spots: NodeHotspot[] = [];
  const taken: Array<[number, number, number]> = []; // row, col, width already claimed

  for (const node of flatten(zone.nodes)) {
    if (NON_UNIT.has(node.id)) continue;
    const found = firstFree(lines, node.label, taken);
    if (!found) continue;
    taken.push([found.row, found.col, node.label.length]);
    spots.push({ id: node.id, label: node.label, ...found, width: node.label.length });
  }
  return spots;
}

function firstFree(
  lines: string[],
  label: string,
  taken: Array<[number, number, number]>,
): { row: number; col: number } | null {
  for (let row = 0; row < lines.length; row += 1) {
    let from = 0;
    for (;;) {
      const col = (lines[row] ?? "").indexOf(label, from);
      if (col === -1) break;
      const clash = taken.some(
        ([r, c, w]) => r === row && col < c + w && col + label.length > c,
      );
      if (!clash) return { row, col };
      from = col + 1;
    }
  }
  return null;
}
