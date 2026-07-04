import { blockChart } from "../../ui/chart.ts";
import type { Container } from "../../data/mock.ts";
import { useRpcQuery } from "../../rpc/hooks.ts";
import type { FleetEvent } from "./useFleet.ts";

// The bottom-anchored cockpit band: whole-host telemetry + the ship's event log +
// a mini-inspector for whatever row the cursor is on. No dead phosphor below the fold.
export function Telemetry({
  selected,
  events,
}: {
  selected: Container | null;
  events: FleetEvent[];
}) {
  // engine-wide cpu/mem from the deep-history metrics feed (short 15m window for the cockpit)
  const { data } = useRpcQuery("metrics.hostHistory", { window: "15m" }, { pollMs: 2000 });
  const cpu = data?.cpu ?? [];
  const mem = data?.mem ?? [];
  const cpuRows = blockChart(cpu, 30, 3);
  const memRows = blockChart(mem, 30, 3);
  const recent = events.slice(-3).toReversed();

  return (
    <div className="telem">
      <div className="telem__charts">
        <div>
          <div className="telem__label">ENGINE CPU ⌁ {Math.round(cpu.at(-1) ?? 0)}%</div>
          <pre className="telem__pre">{cpuRows.join("\n")}</pre>
        </div>
        <div>
          <div className="telem__label">ENGINE MEM ⌁ {Math.round(mem.at(-1) ?? 0)}%</div>
          <pre className="telem__pre">{memRows.join("\n")}</pre>
        </div>
        <div className="telem__log">
          <div className="telem__label">CONTAINMENT LOG</div>
          {recent.length === 0 ? (
            <div className="telem__dim">— containment nominal · no breaches this watch —</div>
          ) : null}
          {recent.map((e) => (
            <div className="telem__dim" key={e.id}>
              <span className="telem__logtime">{e.time}</span> ▸ {e.text}
            </div>
          ))}
        </div>
      </div>
      <div className="telem__inspect">
        {selected
          ? `▸ ${selected.name} · image linuxserver/${selected.name}:latest · ${selected.state} · mem ${selected.mem} · net ${selected.net} · up ${selected.uptime}`
          : "▸ no unit under cursor"}
      </div>
    </div>
  );
}
