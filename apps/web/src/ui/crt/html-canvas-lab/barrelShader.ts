// WebGL2 barrel/pincushion warp for a live-DOM texture.
//
// One fullscreen triangle (positions synthesized from gl_VertexID — no vertex buffer), one
// texture sample per channel. The fragment shader bends UV space with the classic radial law
//   uv = center + dir * (1 - k * r^2)
// (NEGATIVE k bulges OUT — convex CRT glass, magnifies the centre, matches the SVG filter; positive
// k pinches in. A CRT is a mild bulge so pass k slightly negative, e.g. -0.1), then
// adds cheap chromatic aberration (R/G/B warped at slightly different strengths → RGB fringe
// toward the corners) and a radial vignette, to echo the SVG pipeline's "bend + fringe + bloom".
//
// The DOM raster and the render target are decoupled: the texture is whatever native size the
// element rasterized at, and the output resolution is driven by the canvas backing store
// (see `renderScale` in the hook) — so you can super-sample or under-sample independently.

// glsl
const VERT_SRC = `#version 300 es
out vec2 v_uv;
void main() {
  // Fullscreen triangle: verts (0,0) (2,0) (0,2) in UV, mapped to clip (-1..3).
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// glsl
const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform float u_k;        // curvature; negative = barrel (bulge), positive = pincushion
uniform float u_chroma;   // 0..~0.06 chromatic aberration spread
uniform float u_vignette; // 0..1 corner darkening
uniform float u_safe;     // 0..~0.2 safe-zone inset: zoom the content in so the barrel can't push
                          // the edges off-screen; the freed border reads as black "glass".
uniform float u_edge;     // inner edge-shadow band width (fraction of the screen). The CRT bezel
                          // casts a soft shadow onto the glass near the frame; 0 disables it.
uniform float u_bloom;    // HDR bloom gain: bright glyphs glow PAST 1.0 on an extended-range
                          // backbuffer. 0 = off (SDR-identical output).

vec2 barrel(vec2 uv, float k) {
  // Divide the centred coord by (1 - u_safe) BEFORE bending: this reaches further into the texture
  // for a given screen pixel, so the full [0,1] content lands inside a margin instead of the
  // barrel warp throwing the outermost content past the screen edge (the "no safe-zone" clip).
  vec2 c = (uv - 0.5) / max(1.0 - u_safe, 0.001);
  float r2 = dot(c, c);
  // NOTE the MINUS in (1.0 - k*r2): a NEGATIVE curvature magnifies the centre and bows the edges
  // outward, so the glass BULGES OUT (convex CRT) to match the SVG filter. The old (1.0 + k*r2)
  // form bent the image the opposite way (concave / sucked in) for the same negative k.
  return 0.5 + c * (1.0 - k * r2);
}

// 1.0 inside the [0,1] texture, 0.0 outside — so warped-off-edge samples read as black glass.
float inside(vec2 uv) {
  vec2 s = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return s.x * s.y;
}

void main() {
  vec2 uvR = barrel(v_uv, u_k * (1.0 + u_chroma));
  vec2 uvG = barrel(v_uv, u_k);
  vec2 uvB = barrel(v_uv, u_k * (1.0 - u_chroma));

  float r = texture(u_tex, uvR).r * inside(uvR);
  vec4  g = texture(u_tex, uvG);
  float b = texture(u_tex, uvB).b * inside(uvB);
  float m = inside(uvG);

  vec3 col = vec3(r, g.g * m, b);
  float a = g.a * m;

  // HDR core-boost — push the ALREADY-bright glyph pixels past 1.0 (brighter-than-white on an
  // extended-range backbuffer) with NO neighbour halo, so digits/text stay crisp instead of
  // blooming into an unreadable blob. Clamps harmlessly to white on SDR.
  if (u_bloom > 0.0) {
    float lum = max(col.r, max(col.g, col.b));
    col += col * smoothstep(0.55, 1.0, lum) * u_bloom;
  }

  vec2 vc = v_uv - 0.5;
  float vig = clamp(1.0 - u_vignette * dot(vc, vc) * 2.0, 0.0, 1.0);
  col *= vig;

  // Inner edge shadow: the CRT bezel/case casting a soft shadow onto the glass near the frame.
  // Distance to the nearest screen edge (0 at edge, 0.5 at centre); darken within a band of u_edge.
  vec2 ed = min(v_uv, 1.0 - v_uv);
  float edge = min(ed.x, ed.y);
  float shade = smoothstep(0.0, max(u_edge, 0.0001), edge);
  col *= shade;

  outColor = vec4(col, a);
}`;

export interface WarpUniforms {
  curvature: number;
  chroma: number;
  vignette: number;
  /** 0..~0.2 safe-zone inset — content is zoomed in by this fraction so the warp can't clip edges. */
  safeZone: number;
  /** 0..~0.15 inner edge-shadow band — soft dark border simulating the CRT bezel's cast shadow. */
  edgeShadow: number;
  /** HDR bloom gain (0 = off). >0 makes bright glyphs glow past 1.0 on an extended-range buffer. */
  bloom: number;
}

export interface WarpScene {
  /** Upload the current pixels of `source` into the sampled texture. Returns false on failure. */
  upload(source: HTMLElement): boolean;
  /** Draw the warped result to the canvas backing store at its current size. */
  draw(u: WarpUniforms): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader | undefined {
  const sh = gl.createShader(type);
  if (!sh) return undefined;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return undefined;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext): WebGLProgram | undefined {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return undefined;
  const prog = gl.createProgram();
  if (!prog) return undefined;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return undefined;
  }
  return prog;
}

/**
 * Build the warp program, texture, and VAO for a WebGL2 context. `uploadElement` supplies the
 * DOM-to-texture strategy (direct `texElementImage2D`, or a 2D-canvas bridge) chosen by the hook.
 * Returns `undefined` if compilation/allocation fails, so callers fall back to plain DOM.
 */
export function createWarpScene(
  gl: WebGL2RenderingContext,
  uploadElement: (gl: WebGL2RenderingContext, tex: WebGLTexture, source: HTMLElement) => boolean,
): WarpScene | undefined {
  const program = link(gl);
  const tex = gl.createTexture();
  const vao = gl.createVertexArray();
  if (!program || !tex || !vao) {
    if (program) gl.deleteProgram(program);
    if (tex) gl.deleteTexture(tex);
    if (vao) gl.deleteVertexArray(vao);
    return undefined;
  }

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const uTex = gl.getUniformLocation(program, "u_tex");
  const uK = gl.getUniformLocation(program, "u_k");
  const uChroma = gl.getUniformLocation(program, "u_chroma");
  const uVig = gl.getUniformLocation(program, "u_vignette");
  const uSafe = gl.getUniformLocation(program, "u_safe");
  const uEdge = gl.getUniformLocation(program, "u_edge");
  const uBloom = gl.getUniformLocation(program, "u_bloom");

  return {
    upload(source) {
      return uploadElement(gl, tex, source);
    },
    draw(u) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.uniform1f(uK, u.curvature);
      gl.uniform1f(uChroma, u.chroma);
      gl.uniform1f(uVig, u.vignette);
      gl.uniform1f(uSafe, u.safeZone);
      gl.uniform1f(uEdge, u.edgeShadow);
      gl.uniform1f(uBloom, u.bloom);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteTexture(tex);
      gl.deleteVertexArray(vao);
    },
  };
}
