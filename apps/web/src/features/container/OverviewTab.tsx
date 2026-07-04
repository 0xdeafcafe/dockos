import { useState } from "react";
import { blockChart } from "../../ui/chart.ts";
import type { Container } from "../../data/mock.ts";
import type { ContainerPeer } from "@dockos/contract";
import { useRpcQuery } from "../../rpc/hooks.ts";

type Source = "live" | "1h" | "24h";

function Chart({ data, label, live }: { data: number[]; label: string; live: boolean }) {
  const rows = blockChart(data, 92, 9);
  const peak = Math.round(Math.max(1, ...data));
  const now = Math.round(data.at(-1) ?? 0);
  const avg = Math.round(data.reduce((a, b) => a + b, 0) / Math.max(1, data.length));
  const tone = now > 85 ? "err" : now > 60 ? "warn" : "accent";
  // fixed 0–100 y-axis rail so the trace reads against an absolute scale, not window-max
  const axis = ["100", "", "", "", "", "  0"];
  return (
    <div className="ov-chart">
      <div className="ov-chart__head">
        <span className="ov-chart__title">
          {label} {live ? <span className="ov-chart__live">● LIVE</span> : null}
        </span>
        <span className="detail__dim">
          now <b className={`ink--${tone}`}>{now}%</b> · peak <b>{peak}%</b> · avg <b>{avg}%</b>
        </span>
      </div>
      <div className="ov-chart__body">
        <pre className="ov-chart__axis">{axis.join("\n")}</pre>
        <pre className={`ov-chart__plot ink--${tone}`}>{rows.join("\n")}</pre>
      </div>
      <div className="ov-chart__foot">
        └{"─".repeat(46)} {data.length} samples · ~{data.length * 5}s window
      </div>
    </div>
  );
}

function Register({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="overview__reg">
      <div className="detail__dim">{label}</div>
      {lines.map((l) => (
        <div className={`overview__stat ${l.includes("✖") ? "ink--err" : ""}`} key={l}>
          {l}
        </div>
      ))}
    </div>
  );
}

// TALKS TO: the units this container is linked to — reachable on a shared user-defined network or a
// declared compose dependency (from the depends_on label). Each jumps to that unit's detail.
function PeersRegister({
  peers,
  onOpenPeer,
}: {
  peers: ContainerPeer[];
  onOpenPeer?: (name: string) => void;
}) {
  return (
    <div className="overview__reg">
      <div className="detail__dim">TALKS TO</div>
      {peers.length === 0 ? <div className="overview__stat ink--dim">— no linked units —</div> : null}
      {peers.map((p) => (
        <button
          key={`${p.name}·${p.reason}`}
          className="overview__peer"
          onClick={() => onOpenPeer?.(p.name)}
        >
          ▸ {p.name.padEnd(18)} <span className="detail__dim">{p.reason}</span>
        </button>
      ))}
    </div>
  );
}

export function OverviewTab({
  container,
  onOpenPeer,
}: {
  container: Container;
  onOpenPeer?: (name: string) => void;
}) {
  // a stopped unit has no live engine ring buffer — go straight to archive, drop the LIVE affordance,
  // but Prometheus/cadvisor history is still there to show.
  const stopped = container.state === "exited";
  const [source, setSource] = useState<Source>(stopped ? "1h" : "live");
  const { data: d } = useRpcQuery("containers.inspect", { id: container.id }, {});
  const archive = useRpcQuery(
    "metrics.containerHistory",
    { name: container.name, window: source === "24h" ? "24h" : "1h" },
    { enabled: source !== "live" },
  );
  const cpuData = source === "live" ? container.cpuHistory : (archive.data?.cpu ?? []);
  const memData = source === "live" ? container.memHistory : (archive.data?.mem ?? []);
  const sources: Source[] = stopped ? ["1h", "24h"] : ["live", "1h", "24h"];
  return (
    <div className="overview">
      <div className="overview__charts">
        <div className="detail__source">
          <span>SOURCE</span>
          {stopped ? <span className="detail__dim"> ◌ STOPPED · ARCHIVE ONLY </span> : null}
          {sources.map((s) => (
            <button
              key={s}
              className={`detail__tab ${source === s ? "detail__tab--active" : ""}`}
              onClick={() => setSource(s)}
            >
              {s === "live" ? " ● LIVE·ENGINE " : ` ◇ ${s.toUpperCase()}·ARCHIVE `}
            </button>
          ))}
        </div>
        <Chart data={cpuData} label="CPU %" live={source === "live"} />
        <Chart data={memData} label="MEM % OF LIMIT" live={source === "live"} />
      </div>
      <div className="overview__stats">
        <Register
          label="IDENTITY"
          lines={
            d
              ? [
                  d.image,
                  `restart ${d.restart}`,
                  `health  ${d.health}`,
                  `ip      ${d.ip}`,
                  `created ${d.created}`,
                ]
              : ["…"]
          }
        />
        <Register label="PORTS" lines={d?.ports ?? ["…"]} />
        <Register label="MOUNTS" lines={d?.mounts ?? ["…"]} />
        <Register label="NETWORKS" lines={d?.networks ?? ["…"]} />
        <Register
          label="UNIT REGISTERS"
          lines={(d?.registers ?? []).map((r) => `${r.label.padEnd(11)} ${r.value}`)}
        />
        <PeersRegister peers={d?.peers ?? []} {...(onOpenPeer ? { onOpenPeer } : {})} />
      </div>
    </div>
  );
}
