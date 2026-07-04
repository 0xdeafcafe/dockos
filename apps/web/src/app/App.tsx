import { useState } from "react";
import { CrtScene } from "../ui/crt/CrtScene.tsx";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { SoundProvider } from "../sound/SoundProvider.tsx";
import { ErrorProvider } from "../errors/ErrorProvider.tsx";
import { Boot } from "../features/boot/Boot.tsx";
import { Shell } from "../features/shell/Shell.tsx";

export function App() {
  const [booted, setBooted] = useState(false);
  return (
    <ThemeProvider>
      <SoundProvider>
        <ErrorProvider>
          {/* powerCycle=booted → CrtScene replays the tube power-on when the shell takes over,
              collapsing the screen to a line so the table's flat→warped settle is hidden behind
              it (same cover that hides the settle on first load). */}
          <CrtScene powerCycle={booted}>
            {booted ? <Shell /> : <Boot onDone={() => setBooted(true)} />}
          </CrtScene>
        </ErrorProvider>
      </SoundProvider>
    </ThemeProvider>
  );
}
