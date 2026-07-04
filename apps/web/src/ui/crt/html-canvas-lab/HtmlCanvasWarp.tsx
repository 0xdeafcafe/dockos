import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useHtmlCanvasWarp } from "./useHtmlCanvasWarp";

export interface CrtCanvasWarpProps {
  children: ReactNode;
  /** Barrel curvature. Slightly negative = CRT bulge. Default -0.10 (gentle). */
  curvature?: number;
  /** RGB fringe spread. Default 0.012. */
  chroma?: number;
  /** Corner darkening 0..1. Default 0.18. */
  vignette?: number;
  /** Safe-zone inset 0..~0.2 — zooms content in so the warp can't clip edges. Default 0 (off). */
  safeZone?: number;
  /** Inner edge-shadow band 0..~0.15 — soft dark CRT-bezel shadow along the frame. Default 0.06. */
  edgeShadow?: number;
  /** Output resolution multiplier vs CSS px. Default 1 (device-agnostic super-sample knob). */
  renderScale?: number;
  /** Fired when the canvas warp isn't actually available/working (unsupported or it degraded
   *  at runtime) so the host can fall back to a different CRT path instead of showing flat DOM. */
  onUnavailable?: () => void;
}

// When supported, the live children are the canvas's `layoutsubtree` descendants: invisible in
// their own right (canvas children don't paint until drawn) but still laid out, hit-tested,
// selectable, and focusable. The WebGL2 canvas paints the *warped* pixels on top. The two share
// the same box, so pointer/keyboard/selection events land on the real DOM underneath.
//
// INTERACTIVITY CAVEAT: a barrel warp is non-affine, so the drawn pixels bend but the live hit
// region stays a flat rectangle. Clicks/carets map to the *un-warped* layout position — exact at
// center, drifting toward the corners as curvature grows. Fine for mild CRT curvature; document
// the mismatch for anything aggressive. (An affine `drawElementImage` transform could be synced
// back to `style.transform`, but a radial bend has no single affine equivalent.)
// fill the parent (CrtScene mounts this as the full-screen tube), not inline-block
const HOST_STYLE: CSSProperties = { position: "absolute", inset: 0 };
// opacity:0 to start — the hook fades it to 1 on the first real texture (avoids the load flash).
const CANVAS_STYLE: CSSProperties = { display: "block", width: "100%", height: "100%", opacity: 0 };
// Plain-DOM fallback: fill the host normally.
const SOURCE_STYLE: CSSProperties = { position: "absolute", inset: 0 };
// Warped source: anchored top-left, NOT `inset:0`. The hook pins an explicit px width/height on this
// element each frame (see `syncSize`). As the `<canvas layoutsubtree>` direct child it gets paint
// containment, so it needs a definite box — an `inset:0`-only box collapses to 0×0 in the canvas
// layout context and clips the real content away. The explicit size wins; `top/left:0` just anchors.
const WARP_SOURCE_STYLE: CSSProperties = { position: "absolute", top: 0, left: 0 };

export function CrtCanvasWarp({
  children,
  curvature = -0.1,
  chroma = 0.012,
  vignette = 0.18,
  safeZone = 0,
  edgeShadow = 0.06,
  renderScale = 1,
  onUnavailable,
}: CrtCanvasWarpProps) {
  const { supported, canvasRef, sourceRef } = useHtmlCanvasWarp({
    curvature,
    chroma,
    vignette,
    safeZone,
    edgeShadow,
    renderScale,
  });

  useEffect(() => {
    if (!supported) onUnavailable?.();
  }, [supported, onUnavailable]);

  if (!supported) {
    // Plain, fully-interactive DOM. Identical markup shape so styling is stable across the fork.
    return (
      <div style={HOST_STYLE}>
        <div ref={sourceRef} style={SOURCE_STYLE}>
          {children}
        </div>
      </div>
    );
  }

  // The children live *inside* the canvas as its layout subtree (canvas "fallback content" that,
  // with `layoutsubtree`, actually lays out and is hit-tested). The GL context reads them each
  // frame and paints the warped result into the same canvas.
  return (
    <div style={HOST_STYLE}>
      {/* `layoutsubtree` MUST be present from the very first render, not set later in the hook's
          effect: without it on the initial paint the canvas renders its children as ordinary
          (flat, un-warped) fallback DOM for a frame or two — the "shows without warp for half a
          second" flash. With it, the children never paint to screen directly; they only ever appear
          through the warp draw. Spread-applied because it's not in React's known-attribute list. */}
      <canvas ref={canvasRef} style={CANVAS_STYLE} {...{ layoutsubtree: "" }}>
        <div ref={sourceRef} style={WARP_SOURCE_STYLE}>
          {children}
        </div>
      </canvas>
    </div>
  );
}
