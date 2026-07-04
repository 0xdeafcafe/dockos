# CRT SVG-Filter Performance — Browser-Internals Findings

> Scope: making a full-screen SVG `filter` (barrel `feDisplacementMap` + chromatic
> `feColorMatrix`/`feOffset`/`feBlend` + `feGaussianBlur` bloom) over a live React 19
> dashboard hit 60fps in Blink (Chromium) and WebKit (Safari), 2026.
>
> This document is written against the empirical facts already established by the team
> (see "Established facts" below) and grounds each claim in browser-rendering internals
> with primary citations. Read the Executive Summary first, then §A (verdict), §B (is our
> mitigation complete), §C (ranked fixes + layer tree), §D (resolution-cap verdict), §E (cites).

---

## Established facts (given — not re-derived)

1. Filter is on `.crt__warp` wrapping the whole app. Live content under it repaints ~1–2×/s
   (clock @1s, fleet @1.4s). **No 60fps timer under the filter.**
2. Cutting filter primitives (a whole `feDisplacementMap`, the blur-adjacent work): **zero**
   perceptible change ⇒ per-primitive execution cost is **not** dominant.
3. Removing `-webkit-text-stroke` (source-graphic paint cost): **zero** change ⇒ source paint
   is **not** it.
4. **Smoking gun:** a `mix-blend-mode: difference` block-cursor, a *sibling above* the filtered
   layer, repositioned via rAF on every `pointermove`. Removing its blend mode made it smooth.
5. `mix-blend-mode: screen` overlays (scanline sweep, flicker, glass reflection) are siblings
   above the filtered layer, some continuously animated — suspected same cause even mouse-still.
6. Mitigation under test: `isolation: isolate` on `.crt__screen`; `will-change: transform;
   transform: translateZ(0)` on `.crt__warp`.

---

## Background mechanism (how Blink/WebKit actually render this)

**Layers, render surfaces, and cached textures.** Chromium's compositor (cc) does not
re-draw the page every frame. Content layers are rasterized *once* into GPU textures (tiled)
and then **reused across frames** — the compositor only re-transforms/re-composites those
cached textures. Re-rasterization happens only when: (a) the DOM/paint of that layer is
invalidated, (b) new area scrolls in, or (c) the **raster scale changes** (e.g. pinch-zoom /
transform-scale change). This "cache everything, invalidate narrowly" design is explicitly the
core performance strategy of RenderingNG.
[GPU-accelerated compositing](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/),
[RenderingNG](https://developer.chrome.com/docs/chromium/renderingng),
[webperf.tips: Layers & Compositing](https://webperf.tips/tip/layers-and-compositing/).

**Property trees & effect nodes.** Post-`CompositeAfterPaint`, cc drives everything off
separate **transform / clip / effect** trees. A **filter, mask, opacity<1-with-descendants,
backdrop-filter, or a non-`normal` blend mode** lives on an **effect node**, and effect nodes
that must composite their subtree into an intermediate buffer produce a **RenderSurface** — an
off-screen texture the subtree is drawn into before the effect is applied.
[how_cc_works](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/how_cc_works.md),
[BlinkNG / CompositeAfterPaint](https://developer.chrome.com/docs/chromium/blinkng).

**Filters specifically.** Blink represents CSS/SVG filters as an `SkImageFilter` DAG (Skia),
applied when the filtered layer's render surface is produced. The **GPU-accelerated** filter
path is only taken when the *source is already a composited layer*; animated filters get the
GPU path *only for the animation's duration*, then fall back to software. Historically filters
were applied at **record/raster time** (crbug 237641, "Eliminate record-time rasterization of
CSS and SVG filters"), which is exactly the regime where "something above forces a re-record"
re-runs the whole filter.
[Filter Effects design doc](https://www.chromium.org/developers/design-documents/image-filters/),
[crbug 237641](https://bugs.chromium.org/p/chromium/issues/detail?id=237641).

**Blend modes read the backdrop.** Per the Compositing & Blending spec, a non-`normal`
`mix-blend-mode` blends the element against its **backdrop** — the accumulated result of
everything painted *below it within its stacking/isolation group*. To compute that, the
compositor must have the backdrop's pixels available for the element's bounds; a blend mode
therefore **forces a render surface and a backdrop read-back**.
[Compositing and Blending L1](https://www.w3.org/TR/compositing-1/),
[MDN mix-blend-mode](https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode).

The decisive cross-engine confirmation of the *cost model* comes from Gecko/WebRender's own
optimization notes: a naïve `mix-blend-mode` **draws to an intermediate surface and causes
"constant invalidation of picture-cache tiles"**; the fix was a fast path that lets the blend
**use the already-cached picture-cache tiles as the backdrop source**, avoiding the extra
surface and the invalidation.
[bugzilla 1684781 "Improve performance of mix-blend"](https://bugzilla.mozilla.org/show_bug.cgi?id=1684781).
That is precisely our phenomenon, described by the engine authors.

---

## A. Verdict on the smoking-gun diagnosis — CONFIRMED

Your diagnosis is correct and mechanistically sound. The block-cursor with
`mix-blend-mode: difference` sitting **above** the filtered `.crt__warp`, repositioned every
`pointermove` via rAF, forces this chain every composite frame the cursor moves:

1. The blend element needs its **backdrop** = the composited result of everything below it in
   its group, which **includes the filtered `.crt__warp` output**
   ([Compositing L1](https://www.w3.org/TR/compositing-1/)).
2. Moving the blend element changes the covered region → the **backdrop region under it is
   invalidated** every frame ("constant invalidation of picture-cache tiles",
   [bugzilla 1684781](https://bugzilla.mozilla.org/show_bug.cgi?id=1684781)).
3. Because the filtered layer was **not** promoted to a stable, independently-cached render
   surface, producing that backdrop means **re-running the whole `SkImageFilter` DAG** (the
   displacement + chromatic + blur) to regenerate the invalidated backdrop pixels — at 60fps
   ([Filter Effects doc](https://www.chromium.org/developers/design-documents/image-filters/),
   [crbug 237641](https://bugs.chromium.org/p/chromium/issues/detail?id=237641)).

This fully explains facts 2–4: cutting primitives / removing text-stroke did nothing because
the bottleneck was never *per-primitive execution cost* or *source paint* — it was the filter
being **re-executed every frame** because its cache was defeated. Cutting a primitive just made
each of the 60 re-runs marginally cheaper; it didn't stop the re-runs.

And fact 5 is the same mechanism with a different trigger: the `mix-blend-mode: screen`
overlays (sweep/flicker/reflection) are *also* blend-over-backdrop elements. Even with the
mouse still, any that **animate** (their transform/opacity/position changes each frame)
re-invalidate the backdrop region under them, forcing the same filter re-run. So "still not
buttery" with the cursor fixed is expected as long as an animated `screen` overlay reads the
un-cached filtered layer as its backdrop. **The overlays are a second instance of the exact
same bug**, not a separate problem.

---

## B. Is `isolation: isolate` + `will-change/translateZ` the correct & complete fix?

**Correct direction, not yet complete.** Two independent things must both be true, and each of
your two properties supplies only one of them:

- **`will-change: transform` / `translateZ(0)` on `.crt__warp`** — promotes the filtered layer
  to its own compositing layer so its filtered output is rasterized into a **persistent GPU
  texture that is reused across frames** rather than re-recorded. This is what lets a backdrop
  read *sample a cached texture instead of re-filtering*.
  [webperf.tips](https://webperf.tips/tip/layers-and-compositing/),
  [web.dev: compositor-only properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count).
  ⚠️ Caveat: prefer **`will-change: transform`** as the promoter. Do **not** also put
  `will-change: filter` on it while animating — `will-change: filter` keeps the filter on the
  animatable/GPU path and can *prevent* the result from settling into a reusable cached
  texture. You want the filter **static and cached**, not "ready to animate".

- **`isolation: isolate` on `.crt__screen`** — creates an isolated stacking context so every
  blend below it has a **well-defined, bounded backdrop** (the group), which both fixes
  correctness (blends can't reach page background) and lets cc treat the group's backdrop as a
  cacheable unit. Note `isolation: isolate` **does not itself promote a compositing layer** — it
  is purely a stacking-context/isolation hint — so it cannot substitute for the promotion above.
  [MDN isolation](https://developer.mozilla.org/en-US/docs/Web/CSS/isolation),
  [css-tricks / puredevtools on isolation].

**What's missing / must be added for it to be complete:**

1. **The animated `screen` overlays must not invalidate the filtered texture.** Promoting
   `.crt__warp` gives a cached backdrop, but a blend overlay still *reads* it every frame it
   animates. Reading a cached texture is cheap; the trap is any overlay change that **also
   dirties the backdrop's tiles**. Ensure each overlay is its **own** promoted compositing
   layer and animates **only** `transform`/`opacity` (compositor-only), never properties that
   repaint. Give each overlay `will-change: transform` (or `opacity`) and `contain: layout paint`.
2. **The cursor should stay off `mix-blend-mode`** (you already found this). If you truly need
   an invert/difference cursor, use `backdrop-filter: invert(1)` on a *promoted* cursor element
   instead of `mix-blend-mode: difference`, or draw the cursor into the same content layer
   under the filter. `backdrop-filter` also reads the backdrop, but on a promoted cursor over a
   promoted+cached backdrop it samples the cached texture; test it, and if it still costs, fall
   back to a plain (non-blend) cursor.
3. **Confirm promotion actually happened** in DevTools → Layers panel: `.crt__warp` should be a
   single layer whose "Paint count" does **not** increment while the mouse moves / overlays
   animate. If paint count climbs, the cache is still being invalidated and one of the above is
   missing. [LogRocket: Layers panel].
4. **Isolate each blend overlay's group too**, or keep them as siblings *inside* the same
   isolated `.crt__screen` so their backdrop is the cached warp texture — not something that
   forces re-filtering.

---

## C. Ranked concrete fixes + exact layer tree

Ranked by impact-to-effort. #1–#3 are the ones that get you to 60fps; #4–#6 are hardening.

### 1. Promote the filtered layer to a cached texture, and never mutate it at 60fps (biggest win)
```css
.crt__warp {
  filter: url(#crt-warp);          /* the displacement+chromatic+bloom DAG */
  will-change: transform;          /* promote to own compositing layer -> cached texture */
  transform: translateZ(0);        /* belt-and-braces promotion */
  contain: layout paint;           /* bound invalidation to this subtree */
}
```
Rationale: the filter runs once, lands in a GPU texture, and is reused. Everything else in this
section exists to keep that texture from being invalidated.
[webperf.tips](https://webperf.tips/tip/layers-and-compositing/),
[Filter Effects doc](https://www.chromium.org/developers/design-documents/image-filters/).

### 2. Isolate the stacking context so blends have a bounded, cacheable backdrop
```css
.crt__screen { isolation: isolate; }  /* blends below cannot reach page bg; backdrop = this group */
```
[MDN isolation](https://developer.mozilla.org/en-US/docs/Web/CSS/isolation),
[Compositing L1](https://www.w3.org/TR/compositing-1/).

### 3. Make every animated overlay a compositor-only, self-contained layer
```css
.crt__sweep, .crt__flicker, .crt__reflection {
  mix-blend-mode: screen;
  will-change: transform;     /* or opacity — whichever it animates */
  contain: strict;            /* layout+paint+size containment; overlay can't dirty the warp */
  /* animate ONLY transform / opacity via @keyframes or WAAPI on the compositor */
}
```
Rule: overlays may **move/fade** (transform/opacity) but must **never repaint** and must never
force the warp texture to re-record. Each becomes its own render surface that reads the cached
warp backdrop.
[web.dev compositor-only props](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count).

### 4. De-blend the cursor (already validated) — keep it off `mix-blend-mode`
Options, best first: (a) plain colored cursor, no blend; (b) `backdrop-filter: invert(1)` on a
promoted cursor element; (c) render the cursor **into the content layer under the filter** so it
becomes part of the cached source rather than a blend above it. Whatever you pick, the cursor
element gets `will-change: transform` and is moved **only** via `transform: translate()` in rAF
(never `top`/`left`, which repaint).

### 5. Split live data from the filtered chrome if #1–#4 aren't enough (see §E-arch below)
Keep the *filtered* layer static; put the 1–2 Hz live text either inside the cached source
(accepting it re-records at 1–2 Hz — cheap) or **above** the filter with no blend so it never
touches the filter path.

### 6. Cap filter working-buffer resolution only if profiling still shows filter cost (see §D)

### Target layer tree
```
.crt (root)
└─ .crt__screen           isolation: isolate            [isolated stacking context]
   ├─ .crt__warp          filter:url(#crt-warp)
   │                      will-change:transform; translateZ(0); contain:layout paint
   │                      ── CACHED FILTER TEXTURE (rasterized once, reused) ──
   │     └─ <App/>        live dashboard; repaints @1–2Hz -> re-records warp @1–2Hz (fine)
   ├─ .crt__sweep         mix-blend-mode:screen; will-change:transform; contain:strict  [own surface, reads cached backdrop]
   ├─ .crt__flicker       mix-blend-mode:screen; will-change:opacity;   contain:strict
   ├─ .crt__reflection    mix-blend-mode:screen; will-change:transform; contain:strict
   └─ .crt__cursor        NO blend; will-change:transform; transform:translate() via rAF
```
**What must be sacrificed:** if the invert cursor *must* be `mix-blend-mode: difference` over
the filtered layer, you cannot have both it *and* a guaranteed-cached filter while it moves —
the blend-over-filter read is the cost. Choose: drop the blend cursor (recommended) or accept
jank while the mouse moves. Everything else (barrel warp, chromatic, bloom, animated screen
overlays) can coexist at 60fps with the tree above.

---

## D. Resolution-cap verdict

**Can you cap the SVG filter's working-buffer resolution? Short answer: not via the "clean"
CSS knobs; only by genuinely rendering smaller.** On a 2× display the filter region and every
intermediate primitive buffer are allocated at device pixels (≈2× the CSS size), and each pass
(displacement, offset, blur) works at that resolution — which is why buffer size, not primitive
count, dominates once the filter *does* run.

Evaluated options:

- **`filterRes`** — *removed from the spec / not supported.* It was the intended knob for
  exactly this and is gone. Do not rely on it.
  [SVG 1.1 Filter Effects](https://www.w3.org/TR/SVG11/filters.html),
  [Filter Effects Module L1](https://www.w3.org/TR/filter-effects-1/).
- **`<filter primitiveUnits>`** — controls the *coordinate system* for primitive attributes
  (userSpaceOnUse vs objectBoundingBox), **not** raster resolution. No help.
  [SVG 1.1](https://www.w3.org/TR/SVG11/filters.html).
- **`transform: scale(0.7)` inside `scale(1.43)` (net 1×)** — **Confirmed: does NOT reduce
  filter resolution.** CSS transforms are a **paint/composite-time** operation; they do not
  change layout size, and cc rasterizes a layer at its **contents/raster scale = device scale ×
  effective transform scale to screen**. With a net transform of 1.0 the effective scale to
  screen is 1.0, so the warp layer is rastered at layout-size × DPR = **full display
  resolution**, and the filter buffers with it. Your belief is correct: the nested-scale trick
  buys nothing because transforms don't alter the layer's own raster resolution, only the final
  blit. (cc *does* adapt raster scale to a *net* transform scale — a real `scale(0.5)` would
  raster at 0.5× — but then it displays at half size, and scaling it back up blurs.)
  [GPU-accelerated compositing (raster/contents scale)](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/).
- **CSS `image-rendering`** — only chooses the **interpolation** used when *up/down-scaling an
  already-rastered image*; it does not change the filter buffer resolution. No help for the
  filter cost itself.
- **Render filtered content into an offscreen `<canvas>` at low res, then upscale** — this
  **works** and is the only reliable resolution cap, because you control the backing-store
  size. But it means the filtered content is a canvas bitmap, not live interactive DOM: you'd
  lose DOM layout/hit-testing/text selection under the filter. Viable only for the *static
  chrome* layer, not the live dashboard.

**Definitive verdict:** you **cannot** cap an SVG/CSS filter's buffer resolution while keeping
the filtered subtree as live, interactive, full-res DOM. The only genuine reductions require
rendering the filtered content **physically smaller** (real downscale + blur-on-upscale) or
**into a canvas** (loses DOM interactivity). Because §A shows the dominant cost is *how often
the filter runs*, not its per-run buffer size, **prioritize the caching fixes (§C 1–4) and
treat resolution-capping as a last resort** — only pursue it if, after the filter is properly
cached and running at ≤2 Hz, a profiler still shows the ~2 Hz filter re-record itself is too
expensive. In that case, apply the filter to a **static, physically-smaller chrome layer** and
upscale it, keeping live data on an unfiltered layer above (§C 5 / architecture below).

### Cleanest static/split architecture (the "nuclear option")
Split the scene into three planes so the filter is computed rarely or never on data ticks:

```
plane 1  STATIC filtered chrome   (bezel, vignette, static scanline grid, glow)
         -> render once, filter once, cached texture; never touched by data.
         -> optionally rendered smaller + upscaled here ONLY (blur is on-brand for CRT).
plane 2  LIVE data                (clock, fleet)  — UNFILTERED, above plane 1,
         -> repaints @1–2Hz but touches no filter; cheap.
         -> apply a *lightweight* per-glyph chroma/glow via text-shadow, not an SVG filter,
            if you want the live text to look CRT-ish without paying the full filter.
plane 3  ANIMATED overlays        (sweep/flicker/reflection/cursor) — compositor-only,
         -> own promoted layers; read cached backdrops; move via transform/opacity only.
```
This makes the expensive `feDisplacementMap`+chromatic+bloom run **once at load** (plane 1),
so data ticks and 60fps overlay animation never re-run it. The cost is that the live data no
longer gets the *exact* same barrel-warp/chromatic treatment — you approximate it with cheap
per-element shadows. For most CRT UIs this is visually indistinguishable and is the surest path
to rock-solid 60fps.

---

## E. Citations (primary sources first)

Rendering internals (primary):
- Chromium — GPU Accelerated Compositing in Chrome (compositing layers, render surfaces, raster/contents scale, texture caching, re-raster triggers): https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/
- Chromium — Filter Effects design doc (SkImageFilter DAG, GPU path only for composited source, animated-filter-then-fallback): https://www.chromium.org/developers/design-documents/image-filters/
- Chromium — how_cc_works (property trees: transform/clip/effect; effect nodes → render surfaces): https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/how_cc_works.md
- Chrome for Developers — RenderingNG (caching as the core strategy): https://developer.chrome.com/docs/chromium/renderingng
- Chrome for Developers — BlinkNG / CompositeAfterPaint: https://developer.chrome.com/docs/chromium/blinkng
- crbug 237641 — "Eliminate record-time rasterization of CSS and SVG filters": https://bugs.chromium.org/p/chromium/issues/detail?id=237641

Blend-mode / backdrop cost model:
- W3C — Compositing and Blending Level 1 (backdrop, isolated groups): https://www.w3.org/TR/compositing-1/
- Mozilla bugzilla 1684781 — "Improve performance of mix-blend" (naïve blend forces intermediate surface + "constant invalidation of picture-cache tiles"; fast path reuses cached tiles as backdrop): https://bugzilla.mozilla.org/show_bug.cgi?id=1684781
- Mozilla bugzilla 1083241 — mix-blend-mode and CSS filters interaction: https://bugzilla.mozilla.org/show_bug.cgi?id=1083241
- MDN — mix-blend-mode: https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode
- MDN — isolation: https://developer.mozilla.org/en-US/docs/Web/CSS/isolation

Compositor-only animation & layer management:
- web.dev — Stick to compositor-only properties and manage layer count: https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- webperf.tips — Layers and Compositing (textures cached & reused across frames): https://webperf.tips/tip/layers-and-compositing/
- MDN — will-change: https://developer.mozilla.org/en-US/docs/Web/CSS/will-change

SVG filter resolution / performance:
- W3C — SVG 1.1 Filter Effects (filterRes definition; primitiveUnits): https://www.w3.org/TR/SVG11/filters.html
- W3C — Filter Effects Module Level 1 (filterRes removed): https://www.w3.org/TR/filter-effects-1/
- Smashing Magazine — Deep dive into SVG displacement filtering (feDisplacementMap perf, constrain animated area, avoid compound chains on large canvases): https://www.smashingmagazine.com/2021/09/deep-dive-wonderful-world-svg-displacement-filtering/
- WebKit bug 283156 — blur effects on SVG have performance issues: https://bugs.webkit.org/show_bug.cgi?id=283156

---

## WebKit / Safari differences (research Q2)

Same fundamental model, with these deltas:

- WebKit also composites via layers with intermediate buffers for filters/blends, and a
  non-`normal` blend mode likewise **forces an intermediate group surface + backdrop read**
  (Compositing L1 is the shared spec). So the smoking-gun mechanism reproduces on Safari.
- WebKit's SVG filter path has historically been **more CPU-bound / less GPU-accelerated** than
  Blink's, and blur in particular is a known perf sore point
  ([WebKit 283156](https://bugs.webkit.org/show_bug.cgi?id=283156)); the Smashing analysis
  found framerate drops on compound filters across *both* WebKit and Firefox. Net: the *same
  fixes matter more* on Safari — a re-running full-screen filter is even costlier there.
- Layer promotion hints behave similarly (`will-change`, `translateZ(0)` promote; `isolation:
  isolate` creates a stacking context without forcing a GPU layer). Verify in Safari's Web
  Inspector → Layers that `.crt__warp` is a single promoted layer whose paint count is stable
  during mouse-move/overlay animation.
- Practical note: keep the promoted-layer count modest on Safari/iOS (each render surface is
  GPU memory); the three-plane split (§D architecture) is friendlier to WebKit's memory limits
  than many small blend layers.
