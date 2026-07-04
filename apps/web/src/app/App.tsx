import { useState } from "react";
import { CrtScene } from "../ui/crt/CrtScene.tsx";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { SoundProvider } from "../sound/SoundProvider.tsx";
import { ErrorProvider } from "../errors/ErrorProvider.tsx";
import { Boot } from "../features/boot/Boot.tsx";
import { DemoSignIn } from "../features/boot/DemoSignIn.tsx";
import { Shell } from "../features/shell/Shell.tsx";
import { DEMO } from "../demo.ts";

export function App() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  // Demo only: the fake sign-in gates entry AFTER the boot cinematic. With VITE_DEMO unset `gated`
  // is always false, so this collapses to the original booted?Shell:Boot machine unchanged.
  const gated = DEMO && !authed;
  return (
    <ThemeProvider>
      <SoundProvider>
        <ErrorProvider>
          {/* powerCycle → CrtScene replays the tube power-on when the SHELL takes over, collapsing
              the screen to a line so the table's flat→warped settle is hidden behind it. That's the
              sign-in→shell step in demo, and boot→shell otherwise (non-demo: gated is always false,
              so this is exactly `booted`). */}
          <CrtScene powerCycle={booted && !gated}>
            {booted ? (
              gated ? (
                <DemoSignIn onGranted={() => setAuthed(true)} />
              ) : (
                <Shell />
              )
            ) : (
              <Boot onDone={() => setBooted(true)} />
            )}
          </CrtScene>
        </ErrorProvider>
      </SoundProvider>
    </ThemeProvider>
  );
}
