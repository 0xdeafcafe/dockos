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

export function locateHotspots(zone: Zone, art: string): NodeHotspot[] {
  const lines = art.split("\n");
  const spots: NodeHotspot[] = [];
  const taken: Array<[number, number, number]> = []; // row, col, width already claimed

  // Longest labels first: a short name ("api") must not claim the cell of a longer
  // one that contains it ("api-worker") before that box has been located. `nonUnit`
  // nodes are presentational (e.g. the "no containers" placeholder) — never clickable.
  const units = flatten(zone.nodes)
    .filter((n) => !n.nonUnit)
    .toSorted((a, b) => b.label.length - a.label.length);

  for (const node of units) {
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
