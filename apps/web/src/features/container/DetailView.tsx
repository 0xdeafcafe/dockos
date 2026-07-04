import { useEffect, useState } from "react";
import { Dot, Rule } from "../../ui/text.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { ConfirmStrip } from "../../ui/confirm.tsx";
import type { Pending } from "../../ui/confirm.tsx";
import { WordSlam } from "../../ui/slam.tsx";
import { keyOwnedByWidget, useRovingRow } from "../../ui/focus.ts";
import { detailFor } from "../../data/mock.ts";
import type { Container } from "../../data/mock.ts";
import { useSound } from "../../sound/SoundProvider.tsx";
import type { FleetApi } from "../fleet/useFleet.ts";
import { OverviewTab } from "./OverviewTab.tsx";
import { LogsTab } from "./LogsTab.tsx";
import { EnvTab } from "./EnvTab.tsx";
import { FilesTab } from "./FilesTab.tsx";
import "./detail.css";

type Tab = "overview" | "logs" | "env" | "files";
const TABS: Tab[] = ["overview", "logs", "env", "files"];

export function DetailView({
  container,
  api,
  live,
  onBack,
}: {
  container: Container;
  api: FleetApi;
  live: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [pending, setPending] = useState<Pending | null>(null);
  const [slam, setSlam] = useState<"TERMINATED" | "REWIND" | null>(null);
  const roving = useRovingRow<HTMLDivElement>();
  const sound = useSound();
  const d = detailFor(container);

  const doRestart = () => {
    api.restart(container.id);
    setSlam("REWIND");
    sound.play("confirm");
  };
  const doKill = () => {
    api.kill(container.id);
    setSlam("TERMINATED");
    sound.play("error");
    setTimeout(onBack, 700);
  };
  const armRestart = () =>
    setPending({
      question: `REWIND ${container.name.toUpperCase()}?`,
      label: "RESTART",
      detail: "container restarts · uptime resets · brief downtime.",
      run: doRestart,
    });
  const armKill = () =>
    setPending({
      question: `TERMINATE ${container.name.toUpperCase()}?`,
      label: "TERMINATE",
      detail: "unit is removed from the manifest · named volumes persist.",
      danger: true,
      run: doKill,
    });

  useEffect(() => {
    if (!live || pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      const at = Number.parseInt(e.key, 10);
      if (at >= 1 && at <= TABS.length) setTab(TABS[at - 1] ?? "overview");
      else if (e.key === "r") armRestart();
      else if (e.key === "p") api.pause(container.id);
      else if (e.key === "d") armKill();
      else if (e.key === "Escape" || e.key === "Backspace") onBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- handlers close over stable api
  }, [live, pending, container.id]);

  return (
    <div className="detail">
      <div className="detail__head">
        <button className="detail__back" onClick={onBack}>
          {" ‹ ESC · BACK "}
        </button>
        <span className="detail__crumb">
          CONTAINERS ▸ <b>{container.name}</b>
        </span>
        <span className="detail__spacer" />
        <span className="detail__statelamp">
          <Dot state={container.state} />{" "}
          <span className="detail__dim">{container.state.toUpperCase()}</span>
        </span>
      </div>
      <div className="detail__meta">
        <span>
          image <b>{d.image}</b>
        </span>
        <span>
          id <b>{container.id}</b>
        </span>
        <span>
          up <b>{container.uptime}</b>
        </span>
        <span>
          ip <b>{d.ip}</b>
        </span>
      </div>
      <div className="detail__tabs" role="toolbar" tabIndex={-1} onKeyDown={roving}>
        {TABS.map((t, i) => (
          <button
            key={t}
            className={`detail__tab ${tab === t ? "detail__tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {" "}
            <span className="detail__tabkey">{i + 1}</span> {t.toUpperCase()}{" "}
          </button>
        ))}
        <span className="detail__tabfill" />
      </div>
      <Rule tone="dim" />
      <div className="detail__body">
        {tab === "overview" ? <OverviewTab container={container} /> : null}
        {tab === "logs" ? <LogsTab containerId={container.id} /> : null}
        {tab === "env" ? <EnvTab containerId={container.id} /> : null}
        {tab === "files" ? (
          <FilesTab containerName={container.name} live={live && !pending} />
        ) : null}
      </div>
      <Rule tone="dim" />
      {pending ? (
        <ConfirmStrip pending={pending} onDone={() => setPending(null)} />
      ) : (
        <ActionBar
          items={[
            { key: "R", label: "RESTART", onRun: armRestart },
            { key: "P", label: "PAUSE", onRun: () => api.pause(container.id) },
            { key: "D", label: "KILL", onRun: armKill, danger: true },
          ]}
        />
      )}
      {slam ? (
        <WordSlam
          word={slam}
          tone={slam === "TERMINATED" ? "err" : "accent"}
          onDone={() => setSlam(null)}
        />
      ) : null}
    </div>
  );
}
