import { useState } from "react";
import type { ReactNode } from "react";
import { TermScroll } from "../../ui/scroll.tsx";
import { TuiInput } from "../../ui/input.tsx";
import type { LogLine } from "../../data/mock.ts";
import { adaptLogs } from "../../rpc/adapt.ts";
import { useRpcQuery } from "../../rpc/hooks.ts";

function highlight(msg: string, grep: string): ReactNode {
  if (!grep) return msg;
  const at = msg.toLowerCase().indexOf(grep.toLowerCase());
  if (at < 0) return msg;
  return (
    <>
      {msg.slice(0, at)}
      <span className="logline__hit">{msg.slice(at, at + grep.length)}</span>
      {msg.slice(at + grep.length)}
    </>
  );
}

function Line({ line, grep }: { line: LogLine; grep: string }) {
  return (
    <span className={`logline logline--${line.level}`}>
      <span className="logline__time">{line.time}</span>{" "}
      <span className="logline__lvl">{line.level.toUpperCase().padEnd(5)}</span>{" "}
      <span className="logline__src">[{line.source}]</span> {highlight(line.msg, grep)}
    </span>
  );
}

export function LogsTab({ containerId }: { containerId: string }) {
  const [grep, setGrep] = useState("");
  const [follow, setFollow] = useState(true);
  // FOLLOW polls the tail (streaming-ish); PAUSED freezes on the last fetched snapshot.
  const { data } = useRpcQuery(
    "containers.logs",
    { id: containerId, tail: 200 },
    follow ? { pollMs: 1500 } : {},
  );
  const lines: LogLine[] = data ? adaptLogs(data) : [];

  // level is in the haystack: grepping "error" finds the red lines (review P0-3). The list is
  // re-derived from the polled snapshot each render, so filter inline rather than memoize.
  const shown = grep
    ? lines.filter((l) =>
        `${l.level} ${l.msg} ${l.source}`.toLowerCase().includes(grep.toLowerCase()),
      )
    : lines;

  return (
    <>
      <div className="detail__band">
        <button className={follow ? "ink--ok" : "ink--dim"} onClick={() => setFollow((f) => !f)}>
          ● {follow ? "STREAMING" : "PAUSED"}
        </button>
        <span className="detail__dim">GREP</span>
        <TuiInput value={grep} onChange={setGrep} placeholder="…" />
      </div>
      {shown.length === 0 ? (
        <div className="detail__dim">— NO LINES MATCH · CLEAR GREP TO RESUME —</div>
      ) : (
        <TermScroll
          lines={shown.map((l) => (
            <Line key={l.id} line={l} grep={grep} />
          ))}
          follow={follow}
        />
      )}
    </>
  );
}
