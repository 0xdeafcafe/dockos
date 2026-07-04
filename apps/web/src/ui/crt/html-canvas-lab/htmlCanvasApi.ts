// Typed surface + feature detection for Chrome's experimental "HTML-in-Canvas" API.
//
// This API is NOT in lib.dom.d.ts (2026), so we declare the exact experimental methods
// ourselves as narrow interface extensions and reach them through runtime-guarded casts —
// never `any`. Everything here degrades to "unsupported" on non-Chromium/non-flagged
// browsers; nothing throws at import or detection time.
//
// Surface (see README.md for citations):
//   · `<canvas layoutsubtree>`                        — opt canvas children into layout + hit-test
//   · CanvasRenderingContext2D.drawElementImage(...)  — rasterize a DOM subtree into a 2D canvas
//   · WebGL2RenderingContext.texElementImage2D(...)   — upload a DOM subtree straight into a GL texture
//   · canvas `paint` event / requestPaint()           — "content changed, re-upload" signal

/** The affine transform `drawElementImage` returns so you can realign the live DOM node. */
export interface DrawElementTransform {
  toString(): string;
}

/** 2D context augmented with the HTML-in-Canvas rasterization method. */
export interface HtmlCanvas2dContext extends CanvasRenderingContext2D {
  drawElementImage(element: Element, dx: number, dy: number): DrawElementTransform;
}

/** WebGL2 context augmented with the direct DOM-to-texture upload method. */
export interface HtmlCanvasGl2Context extends WebGL2RenderingContext {
  texElementImage2D(
    target: GLenum,
    level: GLint,
    internalformat: GLint,
    format: GLenum,
    type: GLenum,
    element: Element,
  ): void;
}

let probed: boolean | null = null;

// The API name has churned across Canary builds — the 2D method has appeared as
// drawElement / drawElementImage / placeElement, the GL upload as texElementImage2D /
// texElement2D. Probe ALL candidates so detection catches whatever this build ships.
const GL_UPLOAD_NAMES = ["texElementImage2D", "texElement2D"] as const;
const CTX2D_DRAW_NAMES = ["drawElement", "drawElementImage", "placeElement"] as const;

function firstMethod(obj: object, names: readonly string[]): string | undefined {
  for (const n of names) {
    if (typeof (obj as Record<string, unknown>)[n] === "function") return n;
  }
  return undefined;
}

/** Detected method names for this build (empty when unsupported). Logged once for diagnosis. */
export interface HtmlCanvasProbe {
  glUpload?: string | undefined;
  ctx2dDraw?: string | undefined;
}
let probeResult: HtmlCanvasProbe = {};

export function probeHtmlInCanvas(): HtmlCanvasProbe {
  if (probed !== null) return probeResult;
  probed = false;
  probeResult = {};
  if (typeof document === "undefined") return probeResult;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (gl) probeResult.glUpload = firstMethod(gl, GL_UPLOAD_NAMES);
    const ctx = canvas.getContext("2d");
    if (ctx) probeResult.ctx2dDraw = firstMethod(ctx, CTX2D_DRAW_NAMES);
    probed = Boolean(probeResult.glUpload || probeResult.ctx2dDraw);
  } catch {
    probed = false;
  }
  // one-time console diagnostic so we can see exactly what this browser exposes
  // oxlint-disable-next-line no-console
  console.info(
    "[html-in-canvas] probe:",
    probed ? "SUPPORTED" : "not detected",
    probeResult,
    "· webgl2:",
    typeof WebGL2RenderingContext !== "undefined",
  );
  return probeResult;
}

/** True ONLY when the API genuinely functions (a real context exposes a working method). */
export function supportsHtmlInCanvas(): boolean {
  probeHtmlInCanvas();
  return probed === true;
}

/** The direct DOM-to-GL-texture path — the cheapest, preferred way to feed a WebGL2 shader.
 *  Uses the runtime probe (the method lives on the context INSTANCE, not the prototype — the
 *  old prototype check always returned false, which is why the warp always fell back). */
export function supportsGlElementUpload(): boolean {
  probeHtmlInCanvas();
  return probeResult.glUpload !== undefined;
}

/** Narrow a WebGL2 context to the DOM-upload flavour, or `undefined` if unavailable. */
export function asGlElementUploader(
  gl: WebGL2RenderingContext,
): HtmlCanvasGl2Context | undefined {
  return "texElementImage2D" in gl ? (gl as HtmlCanvasGl2Context) : undefined;
}

/** Narrow a 2D context to the element-rasterizing flavour, or `undefined` if unavailable. */
export function asElementRasterizer(
  ctx: CanvasRenderingContext2D,
): HtmlCanvas2dContext | undefined {
  return "drawElementImage" in ctx ? (ctx as HtmlCanvas2dContext) : undefined;
}

/** Canvas augmented with the HTML-in-Canvas paint plumbing.
 *
 *  `requestPaint()` forces the `paint` event to fire once (like `requestAnimationFrame`), even
 *  when no canvas child changed — the browser records a fresh "snapshot of the rendering of all
 *  children of the canvas ... just prior to the `paint` event" (WICG/html-in-canvas explainer).
 *  That snapshot IS the "cached paint record" that `drawElementImage` / `texElementImage2D` read;
 *  calling either before a snapshot exists throws `InvalidStateError: No cached paint record`. */
export interface PaintableCanvas extends HTMLCanvasElement {
  requestPaint(): void;
}

/** Narrow a canvas to the paint-plumbing flavour, or `undefined` when this build lacks it. */
export function asPaintableCanvas(
  canvas: HTMLCanvasElement,
): PaintableCanvas | undefined {
  return "requestPaint" in canvas ? (canvas as PaintableCanvas) : undefined;
}
