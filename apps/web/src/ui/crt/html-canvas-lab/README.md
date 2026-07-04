# HTML-in-Canvas CRT barrel-warp — experimental lab

An **isolated** prototype of the "theoretically correct" way to warp our live CRT DOM: render
the real, interactive DOM subtree into a canvas via Chrome's experimental **HTML-in-Canvas**
API, upload it as a GPU texture, and bend it with a **WebGL2 barrel-distortion** fragment shader.

This folder is standalone. It does **not** import or modify `CrtScene.tsx`, `crt.css`, `App.tsx`,
or anything else in the live pipeline. Nothing here is wired into the app — mount `Demo.tsx`
manually to eyeball it.

> Runtime verification requires **Chrome Canary (or Brave)** with
> `chrome://flags/#canvas-draw-element` enabled. It cannot be exercised in a headless/CI browser
> or in any non-Chromium browser. Every entry point feature-detects and falls back to plain DOM.

---

## API findings (2026)

The proposal lives at **WICG/html-in-canvas** (formerly `WICG/canvas-place-element`; the method
was once floated as `placeElement()` / `drawElement()`, now settled on the `*ElementImage*`
family). Current surface:

| Purpose | Method / attribute | Notes |
| --- | --- | --- |
| Opt canvas children into layout + hit-testing | `<canvas layoutsubtree>` | Direct children get a stacking context, become a containing block, and get paint containment. They lay out and are hit-tested but don't paint until drawn. |
| Rasterize a DOM subtree into a **2D** canvas | `ctx.drawElementImage(element, dx, dy[, …])` | Returns a transform; you assign `element.style.transform = transform.toString()` to keep the live node aligned with its drawn position (needed for the 2D path's interactivity). |
| Upload a DOM subtree straight into a **WebGL2** texture | `gl.texElementImage2D(target, level, internalformat, format, type, element)` | Same shape as `texImage2D` but the source is a DOM element. **This is the path we use** — it feeds a GL sampler directly, no intermediate bitmap. |
| WebGPU equivalent | `device.queue.copyElementImageToTexture(element, { texture })` | Not used here. |
| "Content changed, re-upload" signal | canvas `paint` event + `requestPaint()` | `paint` fires once per frame when any canvas child's rendering changed; `requestPaint()` forces it. |
| Snapshot helper | `captureElementImage(element)` | Returns a reusable `ElementImage`. Not required for our loop. |
| DOM↔draw transform helper | `canvas.getElementTransform(element, drawTransform)` | Converts to an MVP-style matrix for WebGL/WebGPU. Not required here (we warp in the shader, not via an affine). |

### Does it compose with WebGL2? — Yes, directly.

`texElementImage2D` uploads the element into the **bound GL texture**, so a WebGL2 fragment shader
can sample it immediately. That is the preferred path in this lab (`makeUploader` in
`useHtmlCanvasWarp.ts`). We also implement a **fallback bridge** — a scratch 2D canvas +
`drawElementImage`, then a standard `texImage2D(…, scratchCanvas)` — for builds that ship the 2D
method before the GL one. The bridge is best-effort (whether `drawElementImage` accepts an element
that isn't its own canvas child is still unsettled), so it is wrapped in `try/catch` and degrades
to plain DOM on failure rather than throwing.

### How updates work

You do **not** get a persistent live texture handle that auto-updates, and you **cannot** upload
whenever you like. Two hard constraints:

- **Snapshot-per-frame.** *"A snapshot of the rendering of all children of the canvas is recorded
  just prior to the `paint` event"* (WICG explainer). Calling `texElementImage2D` / `drawElementImage`
  **before an initial snapshot exists throws** `InvalidStateError: No cached paint record for element`.
- **Don't upload *inside* the `paint` handler.** Running a GL texture upload synchronously while the
  browser is mid-paint dispatch re-enters the paint machinery and **SIGSEGVs the renderer** ("error
  code 11"). The guidance is explicit: *"we still schedule rendering for the next frame instead of
  calling render() directly, to avoid loop-related issues."*

So the required protocol (this is what `run()` implements) is:

1. **`requestPaint()` every frame** — the documented "update every frame" pattern; a one-shot that
   forces `paint` to fire (analogous to `requestAnimationFrame`) even when no child changed;
2. **the `paint` handler only sets a flag** — it never touches GL;
3. **the next rAF does the upload** — *outside* the paint dispatch, where *"the previous frame's
   snapshot is used"* (it now exists, so it neither throws nor re-enters paint) — then draws.

We run in **continuous** mode (a `requestPaint()` per frame) rather than gating uploads on automatic
content-change paints, because **CSS/compositor animations — deck/route transitions, `transform`,
`opacity` — frequently do NOT fire `paint`**. A change-gated upload therefore freezes the texture
mid-transition (the "ugly animation on deck switch"). The app reports no perceptible lag, so paying
the per-frame rasterize is acceptable here; if it ever bites, gate on `paint` again and accept that
compositor-only animations won't refresh.

Our loop therefore:

- **draws every frame** on rAF — a fullscreen-triangle shader pass is nearly free;
- **re-uploads on the rAF that follows each `paint`** — never synchronously in the event. If the
  build exposes `texElementImage2D` but not `requestPaint()`/`paint`, there's no way to legally prime
  a record, so it cleanly degrades to plain DOM. A 0-area (not-yet-laid-out) subtree is skipped (that
  can fault the driver) and retried next frame.

### Interactivity / hit-testing / selection

With `layoutsubtree`, the live children are laid out, hit-tested, selectable, focusable, and
exposed to the accessibility tree and extensions — the canvas bitmap is purely visual on top of
them. So clicks, carets, text selection, right-click, and form controls work against the **real
DOM underneath**.

**The important caveat for a barrel warp:** the shader bend is *non-affine*, but the live hit
region stays a flat rectangle. Pointer coordinates and carets therefore map to the **un-warped**
layout — exact at the center, drifting outward as curvature increases. Mild CRT curvature is fine;
aggressive curvature visibly desynchronizes the caret from the glyph. There is no affine fix (a
radial bend has no single `style.transform` equivalent); truly warp-accurate hit-testing would
need inverse-mapping pointer events through the shader in JS, which this lab does not attempt.

### Security / tainting constraints

- **No cross-origin iframe content** — the API refuses cross-origin subtrees, so it cannot be used
  to read pixels you couldn't otherwise see. (For our own same-origin CRT DOM this is a non-issue.)
- Standard canvas-tainting rules otherwise apply to whatever you draw.

---

## Enablement

| | |
| --- | --- |
| **Browser** | Chrome Canary, or Brave Stable ≥ 1.89.132 (Chromium ~147+). Also gated behind an **origin trial** for real deployments. |
| **Flag** | `chrome://flags/#canvas-draw-element` → Enabled → relaunch (`brave://flags/#canvas-draw-element` in Brave). |
| **Alt flag** | `--enable-experimental-web-platform-features` also exposes it. |
| **Origin trial** | Register the origin at developer.chrome.com and add the token `<meta http-equiv="origin-trial" content="…">` for non-flagged users. |

### Support matrix

| Browser | Status |
| --- | --- |
| Chrome Canary (~148–150) | Behind flag / origin trial |
| Brave Stable (Chromium 147+) | Behind flag |
| Chrome/Edge Stable | Not shipped (origin trial only) |
| Firefox | No implementation announced |
| Safari / WebKit | No implementation announced |

---

## What works vs. what doesn't (this prototype)

**Works (in a flagged Chromium):**
- Live DOM → GL texture → barrel/pincushion warp with per-channel chromatic aberration + vignette.
- Continuous content (ticking clock) re-uploads per frame; static content re-uploads only on `paint`.
- Output resolution decoupled from DOM size via `renderScale` (super- or under-sample).
- Real interactivity — button clicks, focus, text selection — against the live subtree.

**Doesn't / caveats:**
- **Hit-test drift** toward the corners under strong curvature (non-affine warp; see above).
- Cannot run outside a flagged Chromium — everywhere else it cleanly falls back to plain DOM.
- The 2D-bridge fallback is unverified against the spec's child-element requirement.
- Per-frame **re-upload cost** scales with the rasterized DOM area (see cost model), so a
  constantly-changing full-screen subtree is the expensive case — same content-change trigger that
  the SVG filter pays for, but moved to the GPU.

### Per-frame / update cost model

- **Draw pass:** ~constant. One fullscreen triangle, ≤4 texture fetches/pixel × output pixels
  (`cssArea × renderScale²`). Trivial on any GPU; independent of DOM complexity.
- **Upload pass (only when content changed):** the browser rasterizes the DOM subtree (cost ∝ its
  layout/paint complexity and pixel area) and DMAs it to a texture. This is the real cost and it is
  paid **once per content change**, not per output pixel — so a 4K window costs the same upload as
  a 1080p one for the same DOM.
- Versus the shipped SVG filter: the SVG path re-runs a multi-primitive CPU/compositor filter over
  the **whole output** on every repaint (cost grows with window size → the hitch we see). The
  canvas path replaces that with a fixed GPU shader whose draw cost is flat in DOM complexity;
  only the rasterize-to-texture step tracks content change.

---

## Verdict on production-readiness

**Not yet a drop-in replacement for the SVG filter — keep it as an experiment.** The rendering
model is right and the performance argument is real (flat GPU draw cost vs. window-size-scaling CPU
filter). But three things block promotion to default today:

1. **Availability** — flag/origin-trial-only in Canary + Brave; zero support in Firefox/Safari and
   Chrome Stable. We'd ship it strictly as a progressive enhancement behind the feature-detect,
   with the SVG filter (or plain DOM) as the universal fallback — which is exactly how this lab is
   wired.
2. **Interactivity fidelity** — the non-affine hit-test drift means the caret/selection won't sit
   exactly under warped glyphs near the edges. Acceptable for a decorative CRT at mild curvature;
   not acceptable if the warped surface hosts precise pointer targets.
3. **API churn** — still pre-standard (method names have already changed once), so any adoption
   must isolate the surface behind an adapter like `htmlCanvasApi.ts` here.

**Recommendation:** land this as an opt-in enhancement guarded by `supportsHtmlInCanvas()` for
Canary/Brave users, keep the SVG filter as the default, and revisit promoting it to default once
the API reaches a stable Chromium channel and hit-test-through-warp is addressed.

---

## Files

| File | Role |
| --- | --- |
| `htmlCanvasApi.ts` | Typed surface + feature detection for the experimental API (no `any`). |
| `barrelShader.ts` | WebGL2 program: fullscreen triangle, barrel warp + chromatic aberration + vignette. |
| `useHtmlCanvasWarp.ts` | Hook: GL setup, DOM→texture upload strategy, rAF draw/upload loop, graceful degrade. |
| `HtmlCanvasWarp.tsx` | `CrtCanvasWarp({ children })` — warped when supported, plain DOM when not. |
| `Demo.tsx` | `HtmlCanvasLabDemo` — standalone eyeball harness (clock + counter + selectable text + slider). |

## Citations

- Chrome for Developers — *Introducing the HTML-in-Canvas API origin trial*: https://developer.chrome.com/blog/html-in-canvas-origin-trial
- WICG spec repo — *WICG/html-in-canvas* (README, API): https://github.com/WICG/html-in-canvas
- Draft spec: https://wicg.github.io/html-in-canvas/
- Chrome Platform Status — *HTML-in-canvas*: https://chromestatus.com/feature/5172548013916160
- html-in-canvas.dev — browser support: https://html-in-canvas.dev/docs/browser-support/
