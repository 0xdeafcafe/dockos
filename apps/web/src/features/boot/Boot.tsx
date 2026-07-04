import { useEffect, useRef, useState } from "react";
import { Cursor } from "../../ui/text.tsx";
import { useSound } from "../../sound/SoundProvider.tsx";
import { useTheme } from "../../theme/ThemeProvider.tsx";
import { BANNER_DOCKOS } from "./banners.ts";
import { beginLogin, checkSession, isDeniedOverride } from "./auth.ts";
import { DeniedScene } from "./SignIn.tsx";
import "./boot.css";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Full-screen boot cinematic: dark (tube warms, cursor wanders) → shipboard POST teletype
// with per-line verdicts → SUPERHOT title slam → PRESS ANY KEY. If crew authority can't
// be verified, the scan stamps ✖ UNVERIFIED, an ACCESS VIOLATION alarm strip seizes the
// console, and ACCESS DENIED slams over the sealed sign-in.
// Voice: old shipboard OS — terse, institutional, and USEFUL (each line is a real check).
const POST = [
  "DOCK/OS REV 0.1 — DATA CONTAINMENT ENFORCER",
  "",
  "INTERFACE 2037 READY FOR INQUIRY",
  "",
  "> RUN POST",
  "  CPU 4×VCPU @ 3.20GHZ ............. OK",
  "  CORE MEMORY 16384K ............... OK",
  "  BLK /dev/vda 512G ................ OK",
  "> BRING SUPERVISOR ONLINE",
  "  ENGINE LINK 29.0.3 ............... GOOD",
  "  SOCKET PROXY ..................... GUARDED",
  "  TELEMETRY ARCHIVE ................ GOOD",
  "  MANIFEST homelab ................. 39 UNITS · 5 GROUPS",
  "  VOLUME RAILS ..................... 18 MOUNTED",
  "  NETWORKS ......................... 6 BRIDGED · 1 SEALED (vpn)",
];
const TTY_OK = [...POST, "  CREW AUTHORITY ................... VERIFIED"];
const TTY_DENIED = [
  ...POST,
  "  CREW AUTHORITY ................... ✖ REVOKED — TERMINATED BY THE COMPANY",
];

const ALARM = "▚▚ ACCESS VIOLATION — CONSOLE SEALING ▚▚";

type Phase = "dark" | "tty" | "alarm" | "denied" | "title";

// full ritual vs mini POST — same beats, quicker warm-up / teletype / title spool. Module-scope
// so each is a STABLE reference (the phase effect lists T in its deps; an inline object would
// re-create every render and restart the boot timers).
const BOOT_TIMING_FULL = { dark: 1900, tty: 3, ttyGap: 600, spool: 5, spoolStep: 60 } as const;
const BOOT_TIMING_MINI = { dark: 700, tty: 8, ttyGap: 250, spool: 22, spoolStep: 40 } as const;

function useBootPhases(onDone: () => void, denied: boolean | null, mini: boolean) {
  const T = mini ? BOOT_TIMING_MINI : BOOT_TIMING_FULL;
  // reduced motion skips the ritual: straight to the locked scene or PRESS ANY KEY (once the
  // real auth.session result is known — until then the tube just warms in the dark)
  const [phase, setPhase] = useState<Phase>(() =>
    reduceMotion() && denied !== null ? (denied ? "denied" : "title") : "dark",
  );
  const [chars, setChars] = useState(0);
  const [pct, setPct] = useState(() => (reduceMotion() ? 100 : 0));
  const done = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;
  const deniedRef = useRef(denied);
  deniedRef.current = denied;
  const script = (denied === true ? TTY_DENIED : TTY_OK).join("\n");
  // the boot is REQUIRED — no skipping the ritual. Only the fully-spooled title ("PRESS ANY
  // KEY") accepts a keypress to enter; these refs let the listener check that without re-binding.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pctRef = useRef(pct);
  pctRef.current = pct;

  useEffect(() => {
    if (phase === "dark") {
      // hold in the dark until the real auth check resolves, then warm up + wander → teletype
      if (denied === null) return;
      if (reduceMotion()) {
        setPhase(denied ? "denied" : "title");
        return;
      }
      const t = setTimeout(() => setPhase("tty"), T.dark);
      return () => clearTimeout(t);
    }
    if (phase === "tty") {
      if (chars < script.length) {
        const t = setTimeout(() => setChars((n) => Math.min(script.length, n + T.tty)), 16);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase(denied ? "alarm" : "title"), T.ttyGap);
      return () => clearTimeout(t);
    }
    if (phase === "alarm") {
      // the violation gets its own beat — the scan is SEEN failing before the slam
      const t = setTimeout(() => setPhase("denied"), 1500);
      return () => clearTimeout(t);
    }
    if (phase === "title" && pct < 100) {
      const t = setTimeout(() => setPct((p) => Math.min(100, p + T.spool)), T.spoolStep);
      return () => clearTimeout(t);
    }
  }, [phase, chars, pct, denied, script.length, T]);

  useEffect(() => {
    const enter = () => {
      // no skipping: the whole POST + title must play. Entry is only accepted once we've reached
      // the fully-spooled title (PRESS ANY KEY). The DENIED wall is never key-cleared (VERIFY only),
      // and we never enter before the auth check has actively granted (denied === false).
      if (done.current || deniedRef.current !== false) return;
      if (phaseRef.current !== "title" || pctRef.current < 100) return;
      done.current = true;
      finish.current();
    };
    window.addEventListener("keydown", enter);
    window.addEventListener("pointerdown", enter);
    return () => {
      window.removeEventListener("keydown", enter);
      window.removeEventListener("pointerdown", enter);
    };
  }, []);

  return { phase, setPhase, tty: script.slice(0, chars), pct };
}

// One teletype line, verdict colorized: dot-leader lines split at the leader; the
// verdict stamps green (OK/GOOD/…) or red (✖ UNVERIFIED, blinking).
function TtyLine({ line }: { line: string }) {
  const m = /^(.*?\.{3,} )(.*)$/u.exec(line);
  if (m?.[1] !== undefined && m[2] !== undefined && m[2] !== "") {
    const bad = m[2].includes("✖") || m[2].includes("UNVERIFIED");
    return (
      <div className="boot__line">
        {m[1]}
        <span className={bad ? "boot__bad" : "boot__good"}>{m[2]}</span>
      </div>
    );
  }
  return <div className={`boot__line ${line.startsWith(">") ? "boot__cmd" : ""}`}>{line || " "}</div>;
}

function ConsolePhase({
  phase,
  tty,
  alarm,
}: {
  phase: "dark" | "tty" | "alarm";
  tty: string;
  alarm: boolean;
}) {
  if (phase === "dark") {
    return (
      <div className="boot">
        <div className="boot__tty">
          <span className="boot__wander">
            <Cursor />
          </span>
        </div>
      </div>
    );
  }
  const lines = tty.split("\n");
  return (
    <div className="boot">
      <div className="boot__tty">
        {lines.map((l, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- teletype rows ARE positional
          <TtyLine key={i} line={l} />
        ))}
        {alarm ? <div className="boot__alarmgap"> </div> : <Cursor />}
        {alarm ? <div className="boot__alarm">{ALARM}</div> : null}
      </div>
    </div>
  );
}

// System summary printed under the logo — the machine reporting itself, old-school.
const READY_ROWS: Array<[string, string]> = [
  ["ENGINE", "29.0.3 · socket-proxy guarded"],
  ["MANIFEST", "homelab · 39 units · 5 groups"],
  ["RAILS", "18 volumes · 6 networks · 1 sealed"],
  ["OPERATOR", "operator · crew authority VERIFIED"],
  ["UPTIME", "14d 6h · interface 2037"],
];

// Boot-complete: the logo prints (a quick settle, not a slam), the machine lists its
// vitals, a spool bar fills, then a steady terminal prompt. Reads like a tube warming into
// a ready console, not a splash screen.
function TitleSlam({ pct }: { pct: number }) {
  const bars = Math.round(pct / 5);
  const ready = pct >= 100;
  return (
    <div className="boot">
      <div className="boot__panel">
        <pre className="boot__logo">{BANNER_DOCKOS}</pre>
        <div className="boot__sub">DATA CONTAINMENT ENFORCER · REV 0.1</div>
        <div className="boot__gap"> </div>
        <div className="boot__report">
          {READY_ROWS.map(([k, v]) => (
            <div className="boot__reportrow" key={k}>
              <span className="boot__reportkey">{k.padEnd(10)}</span>
              <span className="boot__reportval">
                {v.includes("VERIFIED") ? (
                  <>
                    {v.replace("VERIFIED", "")}
                    <span className="boot__good">VERIFIED</span>
                  </>
                ) : (
                  v
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="boot__gap"> </div>
        <div className="boot__load">
          <span className="boot__label">SPOOLING</span>
          <span className="boot__bar">
            {"█".repeat(bars)}
            {"░".repeat(20 - bars)}
          </span>
          <span>{String(pct).padStart(3, " ")}%</span>
        </div>
        <div className="boot__status">
          {ready ? (
            <span className="boot__ready">
              dock/os&gt; <span className="ink--blink">READY — PRESS ANY KEY</span> <Cursor />
            </span>
          ) : (
            <span className="ink--dim"> </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function Boot({ onDone }: { onDone: () => void }) {
  const sound = useSound();
  const { bootMini } = useTheme();
  // null while auth.session is in flight; the boot cinematic holds in the dark until it resolves
  const [denied, setDenied] = useState<boolean | null>(() => (isDeniedOverride() ? true : null));
  useEffect(() => {
    let active = true;
    const check = async () => {
      const outcome = await checkSession();
      if (active) setDenied(outcome === "denied");
    };
    void check();
    return () => {
      active = false;
    };
  }, []);
  const { phase, tty, pct } = useBootPhases(onDone, denied, bootMini);
  const played = useRef(false);

  useEffect(() => {
    if (!played.current) {
      played.current = true;
      sound.play("boot");
    }
  }, [sound]);

  useEffect(() => {
    if (phase === "alarm" || phase === "denied") sound.play("error");
  }, [phase, sound]);

  if (phase === "dark" || phase === "tty" || phase === "alarm") {
    return <ConsolePhase phase={phase} tty={tty} alarm={phase === "alarm"} />;
  }

  if (phase === "denied") {
    return <DeniedScene onAuth={() => void beginLogin()} />;
  }

  return <TitleSlam pct={pct} />;
}
