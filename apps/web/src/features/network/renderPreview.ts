/* oxlint-disable no-console -- dev-only preview script, output IS the point */
// Eyeball the generated zone art without a browser:
//   node apps/web/src/features/network/renderPreview.ts
// (node ≥ 24 strips types natively — no build step, no test runner needed)
// Feeds a sample `networks.list` payload through the real builder + renderer, then
// sanity-checks the renderer's invariants: every line ≤ its width, and every box
// border char is vertically aligned with a border char above/below it.

import type { Network } from "@dockos/contract";
import { renderZone } from "./renderTopology.ts";
import { networkToZone, sharedLinks, zoneRenderWidth } from "./topology.ts";

const MAX_WIDTH = 90;

// A sample networks.list result: a bridge that shares "app" with an internal data net
// (→ a shared-container link), plus an empty host net.
const NETWORKS: Network[] = [
  {
    id: "net_bridge",
    name: "homelab_default",
    driver: "bridge",
    scope: "local",
    internal: false,
    containers: ["proxy", "app", "dashboard", "media", "collector", "auth"],
  },
  {
    id: "net_data",
    name: "data_internal",
    driver: "bridge",
    scope: "local",
    internal: true,
    containers: ["app", "db", "queue", "warehouse"],
  },
  { id: "net_host", name: "host", driver: "host", scope: "local", internal: false, containers: [] },
];

const links = sharedLinks(NETWORKS);
let failures = 0;

for (const [index, net] of NETWORKS.entries()) {
  const width = Math.min(MAX_WIDTH, zoneRenderWidth(index));
  const zone = networkToZone(net, links, width);
  const { art, links: linksLine } = renderZone(zone, width);
  console.log(`━━ ${net.name} ${"━".repeat(Math.max(0, 60 - net.name.length))}`);
  console.log(art);
  console.log(linksLine);
  console.log();

  const lines = art.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line.length > width) {
      failures += 1;
      console.error(`✖ ${net.id}: line ${i} is ${line.length} chars (max ${width})`);
    }
  }
  // every └/┘/╚/╝ must sit under a matching │/║/┌/┐/╔/╗/┬ column — misalignment
  // means a box edge drifted
  const verticals = new Set(["│", "║", "┌", "┐", "└", "┘", "╔", "╗", "╚", "╝", "┬", "▼"]);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (let xCol = 0; xCol < line.length; xCol += 1) {
      const ch = line[xCol] ?? " ";
      if (ch !== "└" && ch !== "┘" && ch !== "╚" && ch !== "╝") continue;
      const above = (lines[i - 1] ?? "")[xCol] ?? " ";
      if (!verticals.has(above)) {
        failures += 1;
        console.error(
          `✖ ${net.id}: '${ch}' at ${i}:${xCol} has '${above}' above it — edges misaligned`,
        );
      }
    }
  }
}

console.log(failures === 0 ? "✔ all zones aligned and within width" : `✖ ${failures} failure(s)`);
