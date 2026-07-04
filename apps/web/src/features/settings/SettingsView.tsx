import { useEffect, useState } from "react";
import { Rule } from "../../ui/text.tsx";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { useTheme } from "../../theme/ThemeProvider.tsx";
import { useSound } from "../../sound/SoundProvider.tsx";
import { supportsHtmlInCanvas } from "../../ui/crt/html-canvas-lab/htmlCanvasApi.ts";
import "./settings.css";

interface Row {
  label: string;
  value: string;
  cycle?: () => void;
}

const LABEL_W = 18;
const LEADER_W = 42;

// Cycle orders mirror ThemeProvider's — repeated updater calls compose, so RESET DEFAULTS
// walks each field back to its documented default without reaching into the provider.
const ACCENTS = ["blue", "green", "amber", "hot"];
const DENSITIES = ["tight", "cozy"];
const CRTS = ["full", "lite", "off"];

function stepsTo(list: string[], current: string, target: string): number {
  return (list.indexOf(target) - list.indexOf(current) + list.length) % list.length;
}

// SETTINGS: the SUPERHOT config menu — a roving list, not a table. j/k walks the cursor,
// ←/→/↵ cycles the field under it. Display + audio drive real providers; the backend rows
// are the phase-0 shape of the engine/auth config (phase 1 reads them off the RPC handshake).
export function SettingsView({ live }: { live: boolean }) {
  const theme = useTheme();
  const sound = useSound();
  const canvasAvail = supportsHtmlInCanvas();
  const [sel, setSel] = useState(0);
  const [tls, setTls] = useState("on");
  // backend/identity rows read straight off the RPC handshake (server-configured, not client-set)
  const { data: config } = useRpcQuery("config.get", {}, {});
  const { data: host } = useRpcQuery("host.info", {}, {});
  const { data: session } = useRpcQuery("auth.session", {}, {});

  const resetDefaults = () => {
    for (let n = stepsTo(ACCENTS, theme.accent, "blue"); n > 0; n -= 1) theme.cycleAccent();
    for (let n = stepsTo(DENSITIES, theme.density, "tight"); n > 0; n -= 1) theme.cycleDensity();
    for (let n = stepsTo(CRTS, theme.crt, "lite"); n > 0; n -= 1) theme.cycleCrt();
    if (sound.enabled) sound.toggle();
    setTls("on");
  };

  const rows: Row[] = [
    { label: "ACCENT", value: theme.accent, cycle: theme.cycleAccent },
    { label: "DENSITY", value: theme.density, cycle: theme.cycleDensity },
    { label: "CRT FIDELITY", value: theme.crt, cycle: theme.cycleCrt },
    {
      label: "GPU WARP",
      value: canvasAvail ? (theme.canvasWarp ? "on" : "off") : "unavailable",
      ...(canvasAvail ? { cycle: theme.toggleCanvasWarp } : {}),
    },
    { label: "HDR BLOOM", value: theme.hdr ? "on" : "off", cycle: theme.toggleHdr },
    { label: "BOOT SEQUENCE", value: theme.bootMini ? "mini" : "full", cycle: theme.toggleBootMini },
    { label: "SOUND", value: sound.enabled ? "on" : "off", cycle: sound.toggle },
    { label: "AUTH", value: config?.auth.mode ?? "…" },
    { label: "TLS VERIFY", value: tls, cycle: () => setTls((t) => (t === "on" ? "off" : "on")) },
    { label: "ENGINE ENDPOINT", value: "docker-socket-proxy:2375" },
    { label: "RESET DEFAULTS", value: "run ↵", cycle: resetDefaults },
    { label: "ENGINE", value: host?.engine ?? "…" },
    { label: "VERSION", value: "2037" },
    { label: "OPERATOR", value: session?.operator.username ?? "…" },
  ];

  const cycle = (i: number) => {
    const row = rows[i];
    if (!row?.cycle) return;
    row.cycle();
    sound.play("nav");
  };

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT") return;
      if (e.key === "ArrowDown" || e.key === "j") setSel((s) => Math.min(rows.length - 1, s + 1));
      else if (e.key === "ArrowUp" || e.key === "k") setSel((s) => Math.max(0, s - 1));
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Enter") cycle(sel);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- cycle/rows rebuilt each render off live state
  }, [live, sel, theme, sound.enabled, tls]);

  return (
    <div className="settings">
      <span className="settings__band">DECK CONFIG · phosphor · audio · backend · identity</span>
      <span> </span>
      <div className="settings__list">
        {rows.map((row, i) => {
          const isSel = i === sel;
          const readonly = !row.cycle;
          // read-only rows show a plain value — no ‹ › cycle brackets that imply it's editable
          const value = readonly ? `  ${row.value}` : `‹ ${row.value} ›`;
          const dots = Math.max(2, LEADER_W - LABEL_W - value.length);
          return (
            <button
              key={row.label}
              className={`setrow ${isSel ? "setrow--sel" : ""} ${readonly ? "setrow--ro" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => cycle(i)}
            >
              {isSel ? "▸" : " "} {row.label.padEnd(LABEL_W)}
              <span className="setrow__dots">{".".repeat(dots)}</span>{" "}
              <span className="setrow__val">{value}</span>
              {readonly ? "" : "  ←/→"}
            </button>
          );
        })}
      </div>
      <Rule tone="dim" />
      <span className="settings__hint">
        j/k MOVE · ←/→ or ↵ CHANGE · display + audio persist to this browser
      </span>
      {canvasAvail ? null : (
        <span className="settings__hint">
          ⌁ GPU WARP needs Chrome with chrome://flags → “Experimental Web Platform features”. The
          flat tube (bloom + scanlines) runs everywhere else.
        </span>
      )}
    </div>
  );
}
