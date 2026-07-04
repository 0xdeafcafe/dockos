import { useEffect, useState } from "react";
import { TuiTable } from "../../ui/table.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { Rule } from "../../ui/text.tsx";
import { blockChart } from "../../ui/chart.ts";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import type { Image as ImageAudit } from "@dockos/contract";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { useSound } from "../../sound/SoundProvider.tsx";
import "./system.css";

const STATUS = {
  current: ["● CURRENT ", "ok"],
  outdated: ["▲ OUTDATED", "warn"],
  stale: ["◌ STALE   ", "dim"],
} as const;

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

function headFor(showCve: boolean): string {
  return `  ${pad("IMAGE", 28)} ${pad("TAG", 12)} ${pad("CURRENT", 10)} ${pad("LATEST", 10)} ${pad("STATE", 10)} ${
    showCve ? pad("CVE C/H/M", 10) + " " : ""
  }SIZE`;
}

function HostChart({ data, label, meta }: { data: number[]; label: string; meta: string }) {
  const rows = blockChart(data, 44, 7);
  const now = Math.round(data.at(-1) ?? 0);
  return (
    <div className="system__chart">
      <div className="system__chartband">
        <span className="ink--dim">{label}</span>
        <span className="ink--dim">
          now <b>{now}%</b> · {meta}
        </span>
      </div>
      <pre className="system__pre">{rows.join("\n")}</pre>
    </div>
  );
}

// Host telemetry: registers off host.info, the cpu/mem traces off metrics.hostHistory (deep
// Prometheus history — empty arrays render a flat chart when node_exporter is not scraped).
function HostPanel() {
  const { data: host } = useRpcQuery("host.info", {}, { pollMs: 5000 });
  const { data: hist } = useRpcQuery("metrics.hostHistory", { window: "1h" }, { pollMs: 2000 });
  return (
    <div className="system__host">
      <HostChart data={hist?.cpu ?? []} label="HOST CPU %" meta="4 vcpu" />
      <HostChart data={hist?.mem ?? []} label="HOST MEM %" meta={host?.memText ?? "—"} />
      <div className="system__regs">
        <div className="ink--dim">HOST REGISTERS</div>
        <div className="system__reg">ENGINE     {host?.engine ?? "—"}</div>
        <div className="system__reg">UPTIME     {host?.uptime ?? "—"}</div>
        <div className="system__reg">DISK       {host?.disk ?? 0}% of 512G</div>
        <div className="system__reg">VOLUMES    {host?.volumes ?? 0} rails</div>
        <div className="system__reg">NETWORKS   {host?.networks ?? 0} bridged</div>
      </div>
    </div>
  );
}

function cveText(img: ImageAudit): { text: string; cls: string } {
  const { crit, high, med } = img.cves;
  const text = `${crit}/${high}/${med}`.padEnd(10);
  if (crit > 0) return { text, cls: "ink--err" };
  if (high > 0) return { text, cls: "ink--warn" };
  return { text, cls: "ink--dim" };
}

// SYSTEM: the host itself — cpu/mem telemetry up top, then the image audit: what's
// running, what the registry has, what drifted, and what's carrying CVEs.
// Phase 1: node_exporter + registry digests + trivy scan via the RPC backend.
export function SystemView({ live }: { live: boolean }) {
  const [sel, setSel] = useState(0);
  const [pulse, setPulse] = useState<string | null>(null);
  const sound = useSound();
  const { data: imgData } = useRpcQuery("images.list", {}, { pollMs: 5000 });
  const images = imgData?.images ?? [];
  const { data: cfg } = useRpcQuery("config.get", {}, {});
  const showCve = cfg?.cve ?? false;
  const selected = images[Math.min(sel, images.length - 1)];

  const outdated = images.filter((i) => i.status === "outdated").length;
  const withCves = images.filter((i) => i.cves.crit + i.cves.high > 0).length;

  const act = (verb: "check" | "pull") => {
    if (!selected) return;
    setPulse(selected.repo);
    sound.play("confirm");
    setTimeout(() => setPulse(null), 620);
    void verb;
  };

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "u") act("check");
      else if (e.key === "p") act("pull");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- act closes over current selection
  }, [live, selected]);

  const above = [
    <span className="ink--dim" key="band">
      IMAGE AUDIT · {images.length} TRACKED ·{" "}
      <span className="ink--warn">{outdated} OUTDATED</span>
      {showCve ? (
        <>
          {" "}
          · <span className="ink--err">{withCves} WITH CRIT/HIGH CVES</span>
        </>
      ) : null}
    </span>,
    <span key="g"> </span>,
  ];

  return (
    <div className="system">
      <HostPanel />
      <Rule tone="dim" />
      <TuiTable<ImageAudit>
        head={headFor(showCve)}
        rows={images}
        sel={sel}
        onSel={setSel}
        onOpen={() => act("check")}
        active={live}
        above={above}
        renderRow={(img, isSel, i) => {
          const [glyph, tone] = STATUS[img.status];
          const cve = showCve ? cveText(img) : null;
          return (
            <button
              key={img.id}
              className={`imrow ${isSel ? "imrow--sel" : ""} ${pulse === img.repo ? "imrow--pulse" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => setSel(i)}
            >
              {isSel ? "▸" : " "} {pad(img.repo, 28)} {pad(img.tag, 12)} {pad(img.current, 10)}{" "}
              {pad(img.latest, 10)} <span className={`ink--${tone}`}>{glyph}</span>{" "}
              {cve ? <span className={cve.cls}>{cve.text}</span> : null} {img.size}
            </button>
          );
        }}
      />
      <Rule tone="dim" />
      <ActionBar
        lead={<span>▸ {selected?.repo ?? "—"}</span>}
        items={[
          { key: "U", label: "CHECK REGISTRY", onRun: () => act("check") },
          { key: "P", label: "PULL LATEST", onRun: () => act("pull") },
        ]}
      />
    </div>
  );
}
