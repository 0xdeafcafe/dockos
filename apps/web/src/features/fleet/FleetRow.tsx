import { useEffect, useState } from "react";
import { Bar, Dot, Spark } from "../../ui/text.tsx";
import { ashText, gaugeText, shardText, sparkText } from "../../ui/chart.ts";
import type { Container } from "../../data/mock.ts";
import type { Fx } from "./useFleet.ts";

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

// CPU shows TREND (sparkline history); MEM shows LEVEL (left-to-right gauge of the limit).
function plainRow(c: Container): string {
  const glyph = { up: "●", paused: "◐", exited: "○", unhealthy: "!" }[c.state];
  const memPct = c.memHistory.at(-1) ?? 0;
  return `  ${glyph} ${pad(c.name, 14)} ${pad(c.stack, 7)} ${sparkText(c.cpuHistory.slice(-12))} ${String(
    Math.round(c.cpu),
  ).padStart(3)}%  ${gaugeText(memPct, 8)} ${pad(c.mem, 11)} ${pad(c.net, 10)} ${c.uptime}`;
}

// TIME-REWIND: characters lock back into place right-to-left out of shard noise.
function Rebuild({ target }: { target: string }) {
  const [locked, setLocked] = useState(0);
  useEffect(() => {
    const step = Math.max(2, Math.ceil(target.length / 22));
    const t = setInterval(() => setLocked((n) => Math.min(target.length, n + step)), 28);
    return () => clearInterval(t);
  }, [target.length]);
  const from = target.length - locked;
  return (
    <span className="frow frow--rebuild">
      {shardText(from)}
      {target.slice(from)}
    </span>
  );
}

export function FleetRow({
  container: c,
  selected,
  fx,
  onHover,
  onOpen,
}: {
  container: Container;
  selected: boolean;
  fx: Fx | null;
  onHover: () => void;
  onOpen: () => void;
}) {
  if (fx?.phase === "shatter") return <span className="frow frow--dying">{shardText(78)}</span>;
  if (fx?.phase === "ash") return <span className="frow frow--ash">{ashText(78)}</span>;
  if (fx?.phase === "rebuild") return <Rebuild target={plainRow(c)} />;
  if (fx?.phase === "crawl") return <span className="frow frow--crawl">{plainRow(c)}</span>;

  const memPct = c.memHistory.at(-1) ?? 0;
  const memTone = memPct > 90 ? "err" : memPct > 75 ? "warn" : "accent";
  const cls = ["frow", selected && "frow--sel", c.state === "exited" && "frow--exited"];
  return (
    <button className={cls.filter(Boolean).join(" ")} onMouseEnter={onHover} onClick={onOpen}>
      {selected ? "▸" : " "} <Dot state={c.state} /> {pad(c.name, 14)} {pad(c.stack, 7)}{" "}
      <Spark data={c.cpuHistory.slice(-12)} /> {String(Math.round(c.cpu)).padStart(3)}%{"  "}
      <Bar value={memPct} width={8} tone={memTone} /> {pad(c.mem, 11)} {pad(c.net, 10)} {c.uptime}
    </button>
  );
}
