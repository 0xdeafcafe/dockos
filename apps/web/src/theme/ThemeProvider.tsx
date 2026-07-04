import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Accent = "blue" | "green" | "amber" | "hot";
export type Density = "tight" | "cozy";
export type CrtFidelity = "full" | "lite" | "off";

interface ThemeState {
  accent: Accent;
  density: Density;
  crt: CrtFidelity;
  // experimental: warp via Chrome's HTML-in-Canvas API (GPU shader, resize-proof) instead
  // of the SVG filter. Only takes effect on browsers that support it; SVG is the fallback.
  canvasWarp: boolean;
  // when on, the boot sequence runs a short "mini" POST instead of the full ritual
  bootMini: boolean;
  // experimental: HDR bloom on the canvas path — bright glyphs glow past white on HDR displays
  hdr: boolean;
  cycleAccent: () => void;
  cycleDensity: () => void;
  cycleCrt: () => void;
  toggleCanvasWarp: () => void;
  toggleBootMini: () => void;
  toggleHdr: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

const ACCENTS: Accent[] = ["blue", "green", "amber", "hot"];
const DENSITIES: Density[] = ["tight", "cozy"];
const CRTS: CrtFidelity[] = ["full", "lite", "off"];

function usePersisted<T extends string>(key: string, fallback: T) {
  const state = useState<T>(() => (localStorage.getItem(key) as T | null) ?? fallback);
  const [value] = state;
  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);
  return state;
}

function next<T>(list: T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length] as T;
}

// Changing the field re-magnetizes the tube: a 560ms degauss wobble (crt.css) rides
// every theme/accent cycle. The class restarts cleanly via reflow.
let degaussTimer: ReturnType<typeof setTimeout> | undefined;
function degauss() {
  const el = document.documentElement;
  el.classList.remove("crt-degauss");
  void el.offsetWidth;
  el.classList.add("crt-degauss");
  clearTimeout(degaussTimer);
  degaussTimer = setTimeout(() => el.classList.remove("crt-degauss"), 620);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccent] = usePersisted<Accent>("dockos.accent", "blue");
  const [density, setDensity] = usePersisted<Density>("dockos.density2", "cozy");
  // FULL by default now — the whole optical pipeline (barrel + grain/sweep/flicker/glitch + bloom).
  // Key bumped to crt5 to re-default existing installs. LITE (flat + scanlines) and OFF stay opt-in.
  const [crt, setCrt] = usePersisted<CrtFidelity>("dockos.crt5", "full");
  // Canvas (HTML-in-Canvas GPU) warp defaults ON: it only actually engages where the browser
  // supports it (feature-detected in CrtScene), so on Chrome-with-the-flag you get the real
  // warp automatically, and everywhere else it's a no-op that falls back to the LITE SVG path.
  const [canvasWarp, setCanvasWarp] = usePersisted<"on" | "off">("dockos.canvaswarp2", "on");
  const [bootMini, setBootMini] = usePersisted<"on" | "off">("dockos.bootmini", "off");
  // HDR bloom defaults ON only when the display actually reports high dynamic range; on SDR it stays
  // off (the bloom would just clamp to a mild glow, no benefit). Only engages on the canvas path.
  const [hdr, setHdr] = usePersisted<"on" | "off">(
    "dockos.hdr",
    typeof window !== "undefined" && window.matchMedia("(dynamic-range: high)").matches ? "on" : "off",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  useEffect(() => {
    document.documentElement.dataset.crt = crt;
  }, [crt]);

  const value = useMemo<ThemeState>(
    () => ({
      accent,
      density,
      crt,
      canvasWarp: canvasWarp === "on",
      bootMini: bootMini === "on",
      hdr: hdr === "on",
      cycleAccent: () => {
        degauss();
        setAccent((a) => next(ACCENTS, a));
      },
      cycleDensity: () => setDensity((d) => next(DENSITIES, d)),
      cycleCrt: () => setCrt((c) => next(CRTS, c)),
      toggleCanvasWarp: () => setCanvasWarp((c) => (c === "on" ? "off" : "on")),
      toggleBootMini: () => setBootMini((c) => (c === "on" ? "off" : "on")),
      toggleHdr: () => setHdr((c) => (c === "on" ? "off" : "on")),
    }),
    [
      accent,
      density,
      crt,
      canvasWarp,
      bootMini,
      hdr,
      setAccent,
      setDensity,
      setCrt,
      setCanvasWarp,
      setBootMini,
      setHdr,
    ],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme used outside ThemeProvider");
  return ctx;
}
