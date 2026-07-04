import { useMemo } from "react";
import { useTheme } from "../../theme/ThemeProvider.tsx";
import { useSound } from "../../sound/SoundProvider.tsx";
import { useError } from "../../errors/ErrorProvider.tsx";
import { signOut, simulateDenied } from "../boot/auth.ts";
import { supportsHtmlInCanvas } from "../../ui/crt/html-canvas-lab/htmlCanvasApi.ts";
import type { Command } from "../palette/Palette.tsx";
import type { View } from "./views.ts";

export function useCommands(setView: (v: View) => void): Command[] {
  const theme = useTheme();
  const sound = useSound();
  const err = useError();
  const canvasAvail = supportsHtmlInCanvas();

  return useMemo<Command[]>(
    () => [
      { id: "go-fleet", label: "GO: CONTAINERS", hint: "view", run: () => setView("fleet") },
      { id: "go-stacks", label: "GO: STACKS", hint: "view", run: () => setView("stacks") },
      { id: "go-net", label: "GO: NETWORK MAP", hint: "view", run: () => setView("networks") },
      { id: "go-system", label: "GO: SYSTEM (host · images · cves)", hint: "view", run: () => setView("system") },
      {
        id: "accent",
        label: "CYCLE: ACCENT (blue·green·amber·hot)",
        hint: theme.accent,
        run: theme.cycleAccent,
      },
      { id: "density", label: "CYCLE: DENSITY", hint: theme.density, run: theme.cycleDensity },
      {
        id: "crt",
        label: "CRT: FIDELITY (full·lite·off)",
        hint: theme.crt,
        run: theme.cycleCrt,
      },
      {
        id: "canvaswarp",
        label: canvasAvail
          ? `CRT: GPU CANVAS WARP · ${theme.canvasWarp ? "ON" : "OFF"}`
          : "CRT: GPU CANVAS WARP · UNAVAILABLE — enable chrome flag",
        hint: canvasAvail
          ? theme.canvasWarp
            ? "on — the real barrel warp"
            : "off — toggle on"
          : "chrome://flags → Experimental Web Platform features (copies)",
        run: canvasAvail
          ? theme.toggleCanvasWarp
          : () => {
              void navigator.clipboard?.writeText(
                "chrome://flags/#enable-experimental-web-platform-features",
              );
            },
      },
      {
        id: "hdr",
        label: `CRT: HDR BLOOM · ${theme.hdr ? "ON" : "OFF"}`,
        hint: theme.hdr ? "on — bright glyphs glow past white on HDR displays" : "off — toggle on",
        run: theme.toggleHdr,
      },
      {
        id: "bootmini",
        label: `BOOT: ${theme.bootMini ? "MINI" : "FULL"} SEQUENCE`,
        hint: theme.bootMini ? "mini — switch to full" : "full — switch to mini",
        run: theme.toggleBootMini,
      },
      {
        id: "sound",
        label: `SOUND: ${sound.enabled ? "OFF" : "ON"}`,
        hint: "sfx",
        run: sound.toggle,
      },
      {
        id: "signout",
        label: "SIGN OUT (end session)",
        hint: "auth",
        run: () => void signOut(),
      },
      {
        id: "deny",
        label: "SIMULATE: ACCESS DENIED (reboot)",
        hint: "debug",
        run: simulateDenied,
      },
      {
        id: "fault",
        label: "SIMULATE: SYSTEM FAULT",
        hint: "debug",
        run: () =>
          err.raise({
            kind: "docker.unreachable",
            message: "cannot reach docker engine via socket-proxy",
            meta: { host: "tcp://docker-socket-proxy:2375", attempt: 3 },
            hint: "the deck can't see the fleet. retry, or check the proxy.",
          }),
      },
    ],
    [theme, sound, err, setView, canvasAvail],
  );
}
