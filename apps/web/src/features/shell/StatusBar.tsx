import { useEffect, useState } from "react";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { signOut } from "../boot/auth.ts";
import { useTheme } from "../../theme/ThemeProvider.tsx";
import { useSound } from "../../sound/SoundProvider.tsx";
import { useRovingRow } from "../../ui/focus.ts";

function Clock() {
  const [now, setNow] = useState(() => new Date().toLocaleTimeString("en-GB"));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString("en-GB")), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="statusbar__clock">{now}</span>;
}

// The masthead: inverse brand cap, │-joined ship vitals, a red alert segment when any
// unit is unhealthy, and a roving cluster of deck toggles on the right.
export function StatusBar({
  onPalette,
  running,
  total,
  unhealthy,
  alarm,
  silenced,
  onShowUnhealthy,
  onToggleSilence,
}: {
  onPalette: () => void;
  running: number;
  total: number;
  unhealthy: number;
  alarm: boolean;
  silenced: boolean;
  onShowUnhealthy: () => void;
  onToggleSilence: () => void;
}) {
  const theme = useTheme();
  const sound = useSound();
  const roving = useRovingRow<HTMLSpanElement>();
  const { data: host } = useRpcQuery("host.info", {}, { pollMs: 5000 });
  return (
    <header className="statusbar">
      <span className="statusbar__brand"> DOCK/OS </span>
      <span className="statusbar__meta">
        ● ENGINE <b>{host?.engine ?? "—"}</b> │ UP <b>{host?.uptime ?? "—"}</b> │ CPU{" "}
        <b>{host?.cpu ?? 0}%</b> │ MEM <b>{host?.memText ?? "—"}</b> │ UNITS{" "}
        <b>
          {running}/{total}
        </b>{" "}
        │ DISK <b>{host?.disk ?? 0}%</b>
      </span>
      {unhealthy > 0 ? (
        <span className="statusbar__alertgroup">
          {/* the count JUMPS to the offending unit; SILENCE is a separate toggle */}
          <button
            className={`statusbar__alert ${alarm ? "" : "statusbar__alert--muted"}`}
            onClick={onShowUnhealthy}
            title="show unhealthy unit"
          >
            {alarm ? "! " : "◌ "}
            {unhealthy} UNHEALTHY
          </button>
          <button
            className="statusbar__silence"
            onClick={onToggleSilence}
            title={silenced ? "un-silence alarm" : "silence alarm"}
          >
            [◧ {silenced ? "SILENCED" : "SILENCE"}]
          </button>
        </span>
      ) : null}
      <span className="statusbar__spacer" />
      <span className="statusbar__cluster" role="toolbar" tabIndex={-1} onKeyDown={roving}>
        <button className="statusbar__btn" onClick={onPalette}>
          [⌘K]
        </button>
        <button className="statusbar__btn" onClick={theme.cycleAccent}>
          [◈ {theme.accent.toUpperCase()}]
        </button>
        <button className="statusbar__btn" onClick={theme.cycleCrt}>
          [▦ CRT:{theme.crt.toUpperCase()}]
        </button>
        <button className="statusbar__btn" onClick={sound.toggle}>
          [♪ {sound.enabled ? "ON" : "OFF"}]
        </button>
        <button
          className="statusbar__btn statusbar__signout"
          onClick={() => void signOut()}
          title="sign out — end session"
        >
          [⏻ SIGN OUT]
        </button>
      </span>
      <Clock />
    </header>
  );
}
