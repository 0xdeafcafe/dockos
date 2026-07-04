import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type Sfx = "key" | "nav" | "confirm" | "error" | "boot";

// Retro terminal SFX, synthesized with WebAudio — no samples to ship. OFF by default;
// purely decorative (everything it signals is also visible).
const NOTES: Record<Sfx, [freq: number, ms: number, type: OscillatorType]> = {
  key: [1180, 18, "square"],
  nav: [740, 30, "square"],
  confirm: [520, 70, "triangle"],
  error: [140, 160, "sawtooth"],
  boot: [330, 220, "triangle"],
};

interface SoundState {
  enabled: boolean;
  toggle: () => void;
  play: (sfx: Sfx) => void;
}

const SoundContext = createContext<SoundState | null>(null);

// The tube itself: a barely-audible 55Hz mains hum (+ first harmonic) while sound is on.
function startHum(ctx: AudioContext): () => void {
  const gain = ctx.createGain();
  gain.gain.value = 0.006;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 220;
  const oscA = ctx.createOscillator();
  oscA.type = "sine";
  oscA.frequency.value = 55;
  const oscB = ctx.createOscillator();
  oscB.type = "triangle";
  oscB.frequency.value = 110;
  const gainB = ctx.createGain();
  gainB.gain.value = 0.35;
  oscA.connect(lp);
  oscB.connect(gainB).connect(lp);
  lp.connect(gain).connect(ctx.destination);
  oscA.start();
  oscB.start();
  return () => {
    oscA.stop();
    oscB.stop();
    gain.disconnect();
  };
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("dockos.sound") === "on");
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    localStorage.setItem("dockos.sound", enabled ? "on" : "off");
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    ctxRef.current ??= new AudioContext();
    return startHum(ctxRef.current);
  }, [enabled]);

  const value = useMemo<SoundState>(
    () => ({
      enabled,
      toggle: () => setEnabled((e) => !e),
      play: (sfx) => {
        if (!enabled) return;
        ctxRef.current ??= new AudioContext();
        const ctx = ctxRef.current;
        const [freq, ms, type] = NOTES[sfx];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + ms / 1000);
      },
    }),
    [enabled],
  );

  return <SoundContext value={value}>{children}</SoundContext>;
}

export function useSound(): SoundState {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound used outside SoundProvider");
  return ctx;
}
