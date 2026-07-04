import { useEffect, useState } from "react";
import type { EnvVar } from "../../data/mock.ts";
import { adaptEnv } from "../../rpc/adapt.ts";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { TermScroll } from "../../ui/scroll.tsx";

const NOISE = "▓▒░▚▞█▙▟▛▜";

function noise(len: number): string {
  let s = "";
  for (let i = 0; i < len; i += 1) s += NOISE[Math.floor(Math.random() * NOISE.length)] ?? "▓";
  return s;
}

// Secrets scramble live — funky retro decode. Real DOCK/OS masks these server-side;
// reveal is a separate audited call.
function Scramble({ len }: { len: number }) {
  const [text, setText] = useState(() => noise(len));
  useEffect(() => {
    const t = setInterval(() => setText(noise(len)), 110);
    return () => clearInterval(t);
  }, [len]);
  return <span className="env__noise">{text}</span>;
}

function EnvRow({
  envVar: v,
  masked,
  revealed,
  onToggle,
}: {
  envVar: EnvVar;
  masked: boolean;
  revealed: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="env__row">
      <span className="env__key">{v.key.padEnd(34)}</span>{" "}
      {masked ? (
        <Scramble len={Math.min(28, Math.max(8, v.value.length))} />
      ) : (
        <span className="env__val">{v.value}</span>
      )}
      {v.secret ? (
        <>
          {"  "}
          <button className="env__btn" onClick={onToggle}>
            [{revealed ? "◉ CONCEAL" : "REVEAL"}]
          </button>
        </>
      ) : null}
    </span>
  );
}

export function EnvTab({ containerId }: { containerId: string }) {
  // env is redacted server-side (secret=true arrives already masked); reveal stays a local,
  // audited toggle over what the server sent.
  const { data } = useRpcQuery("containers.env", { id: containerId }, {});
  const vars: EnvVar[] = data ? adaptEnv(data) : [];
  const [redact, setRedact] = useState(true);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const hidden = vars.filter((v) => v.secret).length;

  const toggle = (key: string) =>
    setShown((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return nextSet;
    });

  const lines = [
    <span className="detail__band" key="bar">
      <button className={redact ? "ink--accent" : "ink--dim"} onClick={() => setRedact((r) => !r)}>
        REDACTION ▓ {redact ? "ON " : "OFF"}
      </button>
      <span className="detail__dim">
        {vars.length} VARS · {hidden} SEALED · REVEAL IS AN AUDITED ACTION
      </span>
    </span>,
    <span key="gap"> </span>,
    ...vars.map((v) => (
      <EnvRow
        key={v.key}
        envVar={v}
        masked={v.secret && redact && !shown.has(v.key)}
        revealed={shown.has(v.key)}
        onToggle={() => toggle(v.key)}
      />
    )),
  ];

  return <TermScroll lines={lines} />;
}
