/* oxlint-disable no-console -- dev-only preview script, output IS the point */
// Eyeball the generated zone art without a browser:
//   node apps/web/src/features/network/renderPreview.ts
// (node ≥ 24 strips types natively — no build step, no test runner needed)
// Also sanity-checks the renderer's invariants: every line ≤ maxWidth, and every
// box border char is vertically aligned with a border char above/below it.

import { renderZone } from "./renderTopology.ts";
import { SITE_ZONES } from "./topology.ts";

const MAX_WIDTH = 90;
let failures = 0;

for (const zone of SITE_ZONES) {
  const { art, links } = renderZone(zone, MAX_WIDTH);
  console.log(`━━ ${zone.title} ${"━".repeat(Math.max(0, 60 - zone.title.length))}`);
  console.log(art);
  console.log(links);
  console.log();

  const lines = art.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line.length > MAX_WIDTH) {
      failures += 1;
      console.error(`✖ ${zone.id}: line ${i} is ${line.length} chars (max ${MAX_WIDTH})`);
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
          `✖ ${zone.id}: '${ch}' at ${i}:${xCol} has '${above}' above it — edges misaligned`,
        );
      }
    }
  }
}

console.log(failures === 0 ? "✔ all zones aligned and within width" : `✖ ${failures} failure(s)`);
