import { useMemo } from "react";

// Precompute the barrel displacement map ONCE: a 128×128 field where R/G encode the x/y shift that
// bows a flat raster into convex CRT glass. feDisplacementMap moves each output pixel's SAMPLE by
// scale·(channel/255 − 0.5): centre (R=G=128) → no shift; toward the edges the sample is pulled
// outward ∝ r², so the middle magnifies and straight rails bow out — the same convex bulge the GPU
// canvas shader makes (k negative). Encoded with the SAME `+ n·r²` law as the shader so the two
// warps read identically.
function makeBarrelMap(size = 128): string {
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const nx = (px / (size - 1)) * 2 - 1;
      const ny = (py / (size - 1)) * 2 - 1;
      const r2 = nx * nx + ny * ny;
      const i = (py * size + px) * 4;
      d[i] = Math.max(0, Math.min(255, 128 + nx * r2 * 63.5));
      d[i + 1] = Math.max(0, Math.min(255, 128 + ny * r2 * 63.5));
      d[i + 2] = 0;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}

// Inline <defs> holding the SVG barrel-warp filter for the non-canvas path (engaged at CRT: FULL,
// see crt.css). JUST the bend — one feDisplacementMap driven by the radial map — no chromatic or
// bloom passes (bloom stays in CSS as text-shadow). crt.css promotes + caches the filtered layer
// so it rasterizes once and is reused, not re-run per frame (see SVG-PERF-FINDINGS.md).
export function CrtFilters() {
  const map = useMemo(makeBarrelMap, []);
  return (
    <svg className="crt-defs" aria-hidden focusable="false">
      <defs>
        <filter
          id="crt-warp"
          x="-4%"
          y="-4%"
          width="108%"
          height="108%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={map}
            preserveAspectRatio="none"
            result="map"
            x="0"
            y="0"
            width="100%"
            height="100%"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale="30"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        {/* static phosphor grain — grayscale fractal noise the .crt__grain layer samples */}
        <filter id="crtNoise" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
    </svg>
  );
}
