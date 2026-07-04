import { useEffect, useState } from "react";
import type { Container } from "../../data/mock.ts";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import { FleetView } from "../fleet/FleetView.tsx";
import type { FleetApi } from "../fleet/useFleet.ts";
import { DetailView } from "../container/DetailView.tsx";
import { StacksView } from "../stacks/StacksView.tsx";
import { SystemView } from "../system/SystemView.tsx";
import { ImagesView } from "../images/ImagesView.tsx";
import { VolumesView } from "../volumes/VolumesView.tsx";
import { SettingsView } from "../settings/SettingsView.tsx";
import { NetworkView } from "../network/NetworkView.tsx";
import { Pong } from "../games/Pong.tsx";
import { VIEW_TITLES } from "./views.ts";
import type { View } from "./views.ts";

// Panels still spooling up ship PONG.SYS as their diagnostic idle routine — an easter
// egg with a visible affordance (nothing on the deck is keyboard-only).
function PlaceholderPanel({ view, live }: { view: View; live: boolean }) {
  const [pong, setPong] = useState(false);

  useEffect(() => {
    if (!live || pong) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "p") setPong(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, pong]);

  if (pong) return <Pong active={live} onExit={() => setPong(false)} />;
  return (
    <div className="placeholder">
      <b>{VIEW_TITLES[view]}</b>
      <span>PANEL COMING ONLINE · TRY ⌘K</span>
      <button className="placeholder__pong" onClick={() => setPong(true)}>
        [P] RUN PONG.SYS — DIAGNOSTIC PADDLE ROUTINE
      </button>
    </div>
  );
}

export function MainView({
  view,
  live,
  container,
  fleetApi,
  preset,
  onOpen,
  onBack,
  onJump,
}: {
  view: View;
  live: boolean;
  container: Container | null;
  fleetApi: FleetApi;
  preset: string | null;
  onOpen: (c: Container) => void;
  onBack: () => void;
  onJump: (stack: string) => void;
}) {
  if (view === "fleet")
    return <FleetView api={fleetApi} active={live} preset={preset} onOpen={onOpen} />;
  if (view === "detail" && container)
    return (
      <DetailView container={container} api={fleetApi} live={live} onBack={onBack} onOpen={onOpen} />
    );
  if (view === "stacks") return <StacksView live={live} />;
  if (view === "system") return <SystemView live={live} />;
  if (view === "images") return <ImagesView live={live} />;
  if (view === "volumes") return <VolumesView live={live} />;
  if (view === "settings") return <SettingsView live={live} />;
  if (view === "networks")
    return (
      <NetworkView
        live={live}
        onJump={onJump}
        containers={fleetApi.fleet}
        onOpen={onOpen}
      />
    );
  return <PlaceholderPanel view={view} live={live} />;
}
