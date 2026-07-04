import { useState } from "react";
import { blockChart } from "../../ui/chart.ts";
import { detailFor } from "../../data/mock.ts";
import type { Container } from "../../data/mock.ts";
import { useRpcQuery } from "../../rpc/hooks.ts";

type Source = "live" | "1h" | "24h";

function Chart({ data, label, live }: { data: number[]; label: string; live: boolean }) {
  const rows = blockChart(data, 92, 6);
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
          {label}{" "}
          {live ? <span className="ov-chart__live">● LIVE</span> : null}
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

const STATS: Array<[string, string]> = [
  ["PIDS", "14"],
  ["NET TX", "↑ 2.1G"],
  ["NET RX", "↓ 18.4G"],
  ["BLK R", "402M"],
  ["BLK W", "1.2G"],
  ["THROTTLED", "0.4%"],
  ["RESTARTS", "2"],
  ["OOM KILLS", "0"],
];

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

export function OverviewTab({ container }: { container: Container }) {
  const [source, setSource] = useState<Source>("live");
  const d = detailFor(container);
  // LIVE reads the engine ring buffer already on the container; 1h/24h pull deep history from
  // Prometheus/cadvisor via metrics.containerHistory (empty → flat chart when not scraped).
  const archive = useRpcQuery(
    "metrics.containerHistory",
    { name: container.name, window: source === "24h" ? "24h" : "1h" },
    { enabled: source !== "live" },
  );
  const cpuData = source === "live" ? container.cpuHistory : (archive.data?.cpu ?? []);
  const memData = source === "live" ? container.memHistory : (archive.data?.mem ?? []);
  return (
    <div className="overview">
      <div className="overview__charts">
        <div className="detail__source">
          <span>SOURCE</span>
          {(["live", "1h", "24h"] as Source[]).map((s) => (
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
          lines={[
            d.image,
            `restart ${d.restart}`,
            `health  ${d.health}`,
            `ip      ${d.ip}`,
            `created ${d.created}`,
          ]}
        />
        <Register label="PORTS" lines={d.ports} />
        <Register label="MOUNTS" lines={d.mounts} />
        <Register label="NETWORKS" lines={d.networks} />
        <Register
          label="UNIT REGISTERS"
          lines={STATS.map(([k, v]) => `${k.padEnd(10)} ${v}`)}
        />
      </div>
    </div>
  );
}
