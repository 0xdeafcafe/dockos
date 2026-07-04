import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  asElementRasterizer,
  asGlElementUploader,
  asPaintableCanvas,
  supportsGlElementUpload,
  supportsHtmlInCanvas,
} from "./htmlCanvasApi";
import { createWarpScene } from "./barrelShader";
import type { WarpScene } from "./barrelShader";

export interface WarpOptions {
  /** Barrel curvature; slightly negative bulges the glass like a CRT. */
  curvature: number;
  chroma: number;
  vignette: number;
  /** Safe-zone inset 0..~0.2 — zooms content in so the warp can't push edges off-screen. */
  safeZone: number;
  /** Inner edge-shadow band 0..~0.15 — soft dark border simulating the CRT bezel's cast shadow. */
  edgeShadow: number;
  /** Output backing resolution as a multiple of CSS px. >1 super-samples, <1 saves fill-rate. */
  renderScale: number;
}

export interface WarpHandle {
  supported: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sourceRef: RefObject<HTMLDivElement | null>;
}

type ElementUploader = (
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  source: HTMLElement,
) => boolean;

let uploadErrLogged = false;

// Choose a DOM-to-texture strategy. Preferred: the direct GL upload (`texElementImage2D`), which
// rasterizes the element straight into the bound texture — no intermediate bitmap. Fallback: a
// scratch 2D canvas + `drawElementImage`, then a standard `texImage2D` from that canvas. The
// fallback is best-effort (whether `drawElementImage` accepts a non-child element is still
// unsettled in the spec), so it is wrapped in try/catch and reports failure rather than throwing.
function makeUploader(gl: WebGL2RenderingContext): ElementUploader | undefined {
  const direct = asGlElementUploader(gl);
  if (direct) {
    return (context, tex, source) => {
      try {
        context.bindTexture(context.TEXTURE_2D, tex);
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
        direct.texElementImage2D(
          context.TEXTURE_2D,
          0,
          context.RGBA,
          context.RGBA,
          context.UNSIGNED_BYTE,
          source,
        );
        return true;
      } catch (err) {
        if (!uploadErrLogged) {
          uploadErrLogged = true;
          // oxlint-disable-next-line no-console
          console.warn("[html-in-canvas] texElementImage2D upload failed → falling back:", err);
        }
        return false;
      }
    };
  }

  const scratch = document.createElement("canvas");
  const ctx2d = scratch.getContext("2d");
  const raster = ctx2d ? asElementRasterizer(ctx2d) : undefined;
  if (!raster) return undefined;
  return (context, tex, source) => {
    try {
      const rect = source.getBoundingClientRect();
      scratch.width = Math.max(1, Math.round(rect.width));
      scratch.height = Math.max(1, Math.round(rect.height));
      raster.clearRect(0, 0, scratch.width, scratch.height);
      raster.drawElementImage(source, 0, 0);
      context.bindTexture(context.TEXTURE_2D, tex);
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA,
        context.RGBA,
        context.UNSIGNED_BYTE,
        scratch,
      );
      return true;
    } catch {
      return false;
    }
  };
}

// Keep both boxes in sync with the canvas's laid-out CSS box; returns whether the backing store
// changed (→ re-prime + draw).
//
// Two things are matched here:
//   1. The canvas *backing store* (width/height attributes = drawing-buffer resolution) = CSS box ×
//      renderScale. We read the canvas's OWN CSS box (`clientWidth/Height`, from the 100% style) and
//      set only the attributes, leaving the CSS size responsive to window/host resizes.
//   2. The `source` element's CSS size = the canvas CSS box, in px. This is essential: `source` is
//      the `<canvas layoutsubtree>` direct child, which gets *paint containment* (`contain: paint`).
//      Its `inset:0` absolute box does NOT reliably resolve a containing block inside the canvas
//      layout context (it collapses to 0×0 on current builds), and paint containment then clips the
//      real content inside it to nothing → a 0-width texture. Pinning an explicit definite box gives
//      the content a real area to rasterize. We only write on change to avoid layout/paint thrash.
//
// The DOM texture's resolution is `source`'s own layout size (texElementImage2D rasterizes at that
// size), independent of the backing store — so output res and texture res stay decoupled.
function syncSize(canvas: HTMLCanvasElement, source: HTMLElement, scale: number): boolean {
  const cssW = Math.max(1, Math.round(canvas.clientWidth));
  const cssH = Math.max(1, Math.round(canvas.clientHeight));
  const wPx = `${cssW}px`;
  const hPx = `${cssH}px`;
  if (source.style.width !== wPx) source.style.width = wPx;
  if (source.style.height !== hPx) source.style.height = hPx;

  const w = Math.max(1, Math.round(cssW * scale));
  const h = Math.max(1, Math.round(cssH * scale));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

interface RunArgs {
  canvas: HTMLCanvasElement;
  source: HTMLDivElement;
  scene: WarpScene;
  gl: WebGL2RenderingContext;
  optsRef: RefObject<WarpOptions>;
  onFail: () => void;
}

// Drive the loop. THE PAINT-RECORD PROTOCOL — and why we must NOT upload inside the `paint` handler:
// `texElementImage2D` reads the element's *cached paint record* — "a snapshot ... recorded just prior
// to the `paint` event" (WICG explainer). Uploading before any snapshot throws `InvalidStateError:
// No cached paint record`; uploading synchronously INSIDE the `paint` handler re-enters the paint
// machinery mid-dispatch and SIGSEGVs the renderer ("error code 11"). The documented-safe shape
// (frontendmasters.com "HTML in Canvas": "schedule rendering for the next frame instead of calling
// render() directly"; developer.chrome.com/blog/html-in-canvas-origin-trial): requestPaint() primes
// a snapshot → the `paint` handler only sets a flag → the NEXT rAF uploads (outside paint, using the
// just-recorded snapshot, which now exists) and draws. Returns a stop fn.
function run(args: RunArgs): () => void {
  const { canvas, source, scene, gl, optsRef, onFail } = args;

  const paintable = asPaintableCanvas(canvas);
  if (!paintable) {
    // texElementImage2D exists but the paint/requestPaint plumbing that creates the paint record
    // doesn't, so no snapshot can be primed — degrade instead of throwing on every upload.
    // oxlint-disable-next-line no-console
    console.warn(
      "[html-in-canvas] no requestPaint()/paint event → cannot prime a paint record; degrading",
    );
    onFail();
    return () => {};
  }

  let raf = 0;
  let stopped = false;
  let haveTexture = false;
  let appliedSafe = -1;
  // a snapshot was just recorded → upload it on the next rAF, outside the paint dispatch
  let needUpload = false;

  // Fade the warped canvas in on the first real texture (canvas starts at opacity 0 in CANVAS_STYLE).
  canvas.style.transition = "opacity 300ms ease-out";

  // paint fires AFTER the snapshot is recorded; only flag it — the GL upload happens in `frame`.
  const onPaint = () => {
    needUpload = true;
  };
  canvas.addEventListener("paint", onPaint);
  // Prime the very first snapshot now so the first warped frame lands ~immediately, not a beat later.
  paintable.requestPaint();

  const frame = () => {
    if (stopped) return;
    const opts = optsRef.current;
    syncSize(canvas, source, opts.renderScale);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Mirror the safe-zone's affine shrink onto the SOURCE so its hit region lines up with where the
    // content is DISPLAYED (fix for "cursor not on the hovered item"). Only the affine safe-zone can
    // be mirrored; the non-affine barrel bend still drifts slightly (small at gentle curvature). The
    // upload ignores the element's own transform, so this moves only the hit region, not the texture.
    if (opts.safeZone !== appliedSafe) {
      appliedSafe = opts.safeZone;
      // Skip an identity scale(1) — it still promotes a layer and can blur.
      source.style.transform = opts.safeZone > 0 ? `scale(${1 - opts.safeZone})` : "none";
    }

    // CONTINUOUS mode: a snapshot every frame (the documented "update every frame" use of
    // requestPaint). Automatic content-change paints don't cover CSS/compositor animations (deck
    // transitions, transforms, opacity), so a change-gated upload freezes the texture mid-transition.
    paintable.requestPaint();

    if (needUpload) {
      const rect = source.getBoundingClientRect();
      if (rect.width >= 1 && rect.height >= 1) {
        needUpload = false;
        // Outside the paint dispatch, reading the snapshot recorded by the paint we just observed.
        // (A 0-area/not-yet-laid-out subtree is skipped — handing it to the GPU can fault the driver.)
        if (!scene.upload(source)) {
          onFail();
          return;
        }
        // first real frame → fade the canvas in
        if (!haveTexture) canvas.style.opacity = "1";
        haveTexture = true;
      }
    }

    // Nothing to warp until the first upload has delivered a texture; the shader draws black glass.
    if (haveTexture) scene.draw(opts);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    canvas.removeEventListener("paint", onPaint);
  };
}

/**
 * Feature-detects the HTML-in-Canvas + WebGL2 warp path and, when present, mirrors the live DOM
 * subtree at `sourceRef` into the `canvasRef` canvas through a barrel-distortion shader.
 *
 * When the API (or GL setup) is unavailable it flips `supported` to false and does nothing — the
 * caller then renders the plain children. Never throws on unsupported browsers.
 */
export function useHtmlCanvasWarp(options: WarpOptions): WarpHandle {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  // Detected once. `degraded` demotes to the DOM fallback if GL/program/first-upload fails.
  const [detected] = useState(
    () => supportsHtmlInCanvas() && supportsGlElementUpload(),
  );
  const [degraded, setDegraded] = useState(false);
  const supported = detected && !degraded;

  useEffect(() => {
    if (!supported) return;
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source) return;

    canvas.setAttribute("layoutsubtree", "");
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true });
    const uploader = gl ? makeUploader(gl) : undefined;
    const scene = gl && uploader ? createWarpScene(gl, uploader) : undefined;
    if (!gl || !scene) {
      setDegraded(true);
      return;
    }

    return run({ canvas, source, scene, gl, optsRef, onFail: () => setDegraded(true) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optsRef is a live ref; re-running would tear down GL on every option change
  }, [supported]);

  return { supported, canvasRef, sourceRef };
}
