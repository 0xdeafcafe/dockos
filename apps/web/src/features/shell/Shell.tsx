import { useEffect, useState } from "react";
import { Box } from "../../ui/box.tsx";
import { Rule } from "../../ui/text.tsx";
import type { Container } from "../../data/mock.ts";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { Palette } from "../palette/Palette.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { CanvasHint } from "./CanvasHint.tsx";
import { NavRail } from "./NavRail.tsx";
import { KeyBar } from "./KeyBar.tsx";
import { CommandBar } from "./CommandBar.tsx";
import { MainView } from "./MainView.tsx";
import { usePaneKeys } from "./usePaneKeys.ts";
import { useCommands } from "./useCommands.ts";
import { useFleet } from "../fleet/useFleet.ts";
import type { FleetApi } from "../fleet/useFleet.ts";
import { VIEW_TITLES } from "./views.ts";
import type { View } from "./views.ts";
import "./shell.css";

export function Shell() {
  const [view, setView] = useState<View>("fleet");
  const [pane, setPane] = useState<"nav" | "main">("main");
  const [container, setContainer] = useState<Container | null>(null);
  const [palette, setPalette] = useState(false);
  const [cmdActive, setCmdActive] = useState(false);
  const commands = useCommands(setView);
  const fleetApi = useFleet();

  usePaneKeys({
    paletteOpen: palette,
    cmdActive,
    setPane,
    togglePane: () => setPane((p) => (p === "nav" ? "main" : "nav")),
    back: () => setView((v) => (v === "detail" ? "fleet" : v)),
    openPalette: () => setPalette((o) => !o),
    focusCmd: () => setCmdActive(true),
  });

  const [preset, setPreset] = useState<string | null>(null);

  const openDetail = (c: Container) => {
    setContainer(c);
    setView("detail");
  };

  const commitView = (v: View) => {
    setView(v);
    setPane("main");
  };

  const jumpToStack = (stack: string) => {
    setPreset(stack);
    setView("fleet");
    setPane("main");
  };

  return (
    <ShellFrame
      view={view}
      pane={pane}
      palette={palette}
      cmdActive={cmdActive}
      container={container}
      commands={commands}
      fleetApi={fleetApi}
      preset={preset}
      onJump={jumpToStack}
      openDetail={openDetail}
      commitView={commitView}
      setView={setView}
      setPalette={setPalette}
      setCmdActive={setCmdActive}
    />
  );
}

function ShellFrame({
  view,
  pane,
  palette,
  cmdActive,
  container,
  commands,
  fleetApi,
  preset,
  onJump,
  openDetail,
  commitView,
  setView,
  setPalette,
  setCmdActive,
}: {
  view: View;
  pane: "nav" | "main";
  palette: boolean;
  cmdActive: boolean;
  container: Container | null;
  commands: ReturnType<typeof useCommands>;
  fleetApi: FleetApi;
  preset: string | null;
  onJump: (stack: string) => void;
  openDetail: (c: Container) => void;
  commitView: (v: View) => void;
  setView: (v: View) => void;
  setPalette: (open: boolean) => void;
  setCmdActive: (a: boolean) => void;
}) {
  const suspended = palette || cmdActive;
  const running = fleetApi.fleet.filter((c) => c.state !== "exited").length;
  const unhealthy = fleetApi.fleet.filter((c) => c.state === "unhealthy").length;
  // silencing hushes the alarm until the situation changes (a new/cleared unhealthy re-arms)
  const [silenced, setSilenced] = useState(false);
  useEffect(() => {
    setSilenced(false);
  }, [unhealthy]);
  const alarm = unhealthy > 0 && !silenced;
  const { data: imgData } = useRpcQuery("images.list", {}, { pollMs: 30000 });
  const cveWarn = (imgData?.images ?? []).some((i) => i.cves.crit + i.cves.high > 0);
  const firstUnhealthy = fleetApi.fleet.find((c) => c.state === "unhealthy");
  const crumb =
    view === "detail" && container ? `CONTAINERS ▸ ${container.name}` : VIEW_TITLES[view];
  return (
    <div className="shell">
      <StatusBar
        onPalette={() => setPalette(true)}
        running={running}
        total={fleetApi.fleet.length}
        unhealthy={unhealthy}
        alarm={alarm}
        silenced={silenced}
        onShowUnhealthy={() => firstUnhealthy && openDetail(firstUnhealthy)}
        onToggleSilence={() => setSilenced((s) => !s)}
      />
      <Rule tone="dim" />
      <CanvasHint />
      <ShellPanes
        view={view}
        pane={pane}
        suspended={suspended}
        alarm={alarm}
        cveWarn={cveWarn}
        container={container}
        fleetApi={fleetApi}
        preset={preset}
        onJump={onJump}
        openDetail={openDetail}
        commitView={commitView}
        setView={setView}
      />
      {/* command deck sits ABOVE the key legend so the input line clears the tube's curved
          bottom edge and is actually noticeable */}
      <CommandBar commands={commands} active={cmdActive} onActiveChange={setCmdActive} />
      <KeyBar view={view} crumb={crumb} />
      {/* mounted only while open: guarantees fresh query state every time (P0 stale-input fix) */}
      {palette ? <Palette open onClose={() => setPalette(false)} commands={commands} /> : null}
    </div>
  );
}

function ShellPanes({
  view,
  pane,
  suspended,
  alarm,
  cveWarn,
  container,
  fleetApi,
  preset,
  onJump,
  openDetail,
  commitView,
  setView,
}: {
  view: View;
  pane: "nav" | "main";
  suspended: boolean;
  alarm: boolean;
  cveWarn: boolean;
  container: Container | null;
  fleetApi: FleetApi;
  preset: string | null;
  onJump: (stack: string) => void;
  openDetail: (c: Container) => void;
  commitView: (v: View) => void;
  setView: (v: View) => void;
}) {
  return (
    <div className="shell__mid">
      <div className="shell__nav">
        <Box title="DECK" focus={pane === "nav"} fill>
          <NavRail
            view={view}
            focused={pane === "nav" && !suspended}
            alert={alarm}
            cveWarn={cveWarn}
            onView={commitView}
          />
        </Box>
      </div>
      <div className="shell__main">
        <Box title={VIEW_TITLES[view]} focus={pane === "main"} fill>
          {/* keyed on view: the page-tear roll plays on every view switch */}
          <div className="shell__roll" key={view}>
            <MainView
              view={view}
              live={pane === "main" && !suspended}
              container={container}
              fleetApi={fleetApi}
              preset={preset}
              onJump={onJump}
              onOpen={openDetail}
              onBack={() => setView("fleet")}
            />
          </div>
        </Box>
      </div>
    </div>
  );
}
