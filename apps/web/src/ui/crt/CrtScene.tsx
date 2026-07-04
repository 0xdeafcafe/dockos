import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "../../theme/ThemeProvider.tsx";
import { CrtFilters } from "./CrtFilters.tsx";
import { CrtCanvasWarp } from "./html-canvas-lab/HtmlCanvasWarp.tsx";
import { supportsHtmlInCanvas } from "./html-canvas-lab/htmlCanvasApi.ts";
import "./crt.css";

// The tube. There is ONE warp now — the GPU one, via Chrome's HTML-in-Canvas API — because a
// full-screen SVG filter over live-updating content can't be made buttery. So:
//   · CANVAS (Chrome flag + feature-detected): the real barrel warp of the actual text, done
//     in a WebGL shader that never re-filters on DOM change. Runs from boot onward.
//   · SVG / non-canvas fallback: FLAT glass — no barrel — but with phosphor bloom (CSS
//     text-shadow) + scanlines + vignette, which reads as a CRT and stays perfectly smooth.
//   · OFF: flat panel, nothing.

// Barrel parameters — shared by the shader (CrtCanvasWarp) AND the cursor inverse-map so the
// caret block lands exactly on the bent glyph it's over.
const CURVATURE = -0.16;
const CHROMA = 0.03;
const VIGNETTE = 0.2;

// Inverse of barrelShader's forward map (safe-zone 0). The pointer hit-tests against the FLAT DOM
// living inside the canvas (texture space), but the GPU DISPLAYS that content bent. So the true
// pointer (clientX/Y) is a *texture* coordinate; to draw the block where that content actually
// appears we solve the forward law  δ = ρ − k·ρ³  (δ = |texture offset|, ρ = |display offset|) for
// ρ via Newton, then rescale. Without this the block drifts toward centre exactly as the content
// bows out — the "cursor no longer aligning" on the canvas path. (`cursor:none` globally, so this
// block IS the only pointer; aligning it to the warped image is the whole point.)
function warpPoint(px: number, py: number, k: number): [number, number] {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  const dx = px / w - 0.5;
  const dy = py / h - 0.5;
  const delta = Math.hypot(dx, dy);
  if (delta < 1e-4) return [px, py];
  let rho = delta;
  for (let i = 0; i < 6; i += 1) {
    const f = rho - k * rho * rho * rho - delta;
    const df = 1 - 3 * k * rho * rho;
    rho -= f / df;
  }
  const scale = rho / delta;
  return [(0.5 + dx * scale) * w, (0.5 + dy * scale) * h];
}

// A block caret. Plain translucent block on the flat path; the classic invert caret in canvas
// mode (crt.css swaps it to mix-blend when .crt--canvas is set — cheap over the GPU texture). When
// `warpK` is set (canvas path) the block position is bent through the same barrel as the image.
function CrtCursor({ warpK }: { warpK: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const kRef = useRef(warpK);
  kRef.current = warpK;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let x = -50;
    let y = -50;
    const paint = () => {
      raf = 0;
      const k = kRef.current;
      const [px, py] = k === null ? [x, y] : warpPoint(x, y, k);
      el.style.transform = `translate(${px}px, ${py}px)`;
    };
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return <div className="crt__cursor" ref={ref} aria-hidden />;
}

export function CrtScene({ children, powerCycle }: { children: ReactNode; powerCycle?: unknown }) {
  const { canvasWarp, crt } = useTheme();
  // probe once on load so the console reports HTML-in-Canvas support (or its absence)
  useEffect(() => {
    supportsHtmlInCanvas();
  }, []);
  // canvasFailed latches if the GPU warp can't actually render at runtime → fall back to flat.
  const [canvasFailed, setCanvasFailed] = useState(false);
  useEffect(() => {
    setCanvasFailed(false);
  }, [canvasWarp]);

  // Replay the tube power-on whenever `powerCycle` changes (App flips it on boot→shell). The
  // boot→shell handoff swaps in a whole new (table-dense) subtree; on the dense grid the always-on
  // barrel is suddenly, glaringly visible and reads as the table "popping warped". Collapsing the
  // screen to a scan-line and blooming it back covers that reveal — the same power-on that hides
  // the settle on first load. Driven by the Web Animations API (NOT a CSS class/animation restart,
  // which silently no-ops when the element already carries `animation: crt-on`): `.animate()` always
  // starts a fresh instance. Runs as a layout effect so the collapse is committed BEFORE the new
  // shell's first paint — no un-covered frame leaks through.
  const screenRef = useRef<HTMLDivElement>(null);
  const firstPower = useRef(true);
  useLayoutEffect(() => {
    if (firstPower.current) {
      firstPower.current = false;
      return;
    }
    const el = screenRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: "scale(0.004, 0.003)", filter: "brightness(9)", opacity: 0, offset: 0 },
        { transform: "scale(0.08, 0.004)", filter: "brightness(8)", opacity: 1, offset: 0.16 },
        { transform: "scale(1, 0.004)", filter: "brightness(6)", opacity: 1, offset: 0.42 },
        { transform: "scale(1, 0.02)", filter: "brightness(3.4)", opacity: 1, offset: 0.6 },
        { transform: "scale(1, 1.05)", filter: "brightness(2)", opacity: 1, offset: 0.8 },
        { transform: "scale(1, 1)", filter: "brightness(1)", opacity: 1, offset: 1 },
      ],
      { duration: 560, easing: "ease-out" },
    );
  }, [powerCycle]);

  // The canvas warp runs from the very first frame (boot included) — its warm-up hides behind
  // the boot's dark phase, and running it throughout avoids a mid-session flat→warp swap flash.
  const useCanvas = canvasWarp && crt !== "off" && !canvasFailed && supportsHtmlInCanvas();

  if (useCanvas) {
    return (
      <div className="crt crt--canvas">
        <div className="crt__screen" ref={screenRef}>
          <CrtCanvasWarp
            curvature={CURVATURE}
            chroma={CHROMA}
            vignette={VIGNETTE}
            onUnavailable={() => setCanvasFailed(true)}
          >
            <div className="crt__content">{children}</div>
          </CrtCanvasWarp>
          <div className="crt__mask" />
          <div className="crt__scan" />
          <div className="crt__vign" />
          <CrtCursor warpK={CURVATURE} />
        </div>
      </div>
    );
  }

  // Non-canvas path: flat glass + phosphor bloom (crt.css) at LITE; at FULL the SVG barrel filter
  // (#crt-warp, from CrtFilters) bends `.crt__warp` — the real warp for browsers without the flag.
  return (
    <div className="crt">
      <CrtFilters />
      <div className="crt__screen" ref={screenRef}>
        <div className="crt__warp">
          <div className="crt__content">{children}</div>
        </div>
        <div className="crt__mask" />
        <div className="crt__scan" />
        <div className="crt__vign" />
        <CrtCursor warpK={null} />
      </div>
    </div>
  );
}
