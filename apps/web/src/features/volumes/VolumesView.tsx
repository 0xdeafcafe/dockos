import { useEffect, useState } from "react";
import { TuiTable } from "../../ui/table.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { ConfirmStrip } from "../../ui/confirm.tsx";
import type { Pending } from "../../ui/confirm.tsx";
import { Rule } from "../../ui/text.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import { VOLUMES } from "../../data/mock.ts";
import type { Volume } from "../../data/mock.ts";
import { useSound } from "../../sound/SoundProvider.tsx";
import "./volumes.css";

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

function isDangling(v: Volume): boolean {
  return v.usedBy.length === 0;
}

function mb(size: string): number {
  const n = Number(size.replaceAll(/[^\d.]/gu, ""));
  if (size.endsWith("G")) return n * 1024;
  if (size.endsWith("K")) return n / 1024;
  return n;
}
function fmtMb(v: number): string {
  return v >= 1024 ? (v / 1024).toFixed(1) + "G" : Math.round(v) + "M";
}

const HEAD = `  ${pad("NAME", 24)} ${pad("DRIVER", 8)} ${pad("SIZE", 7)} ${pad("USED BY", 20)} AGE`;

// VOLUMES: the persistent rails — what's mounted where, how big, and which have been
// orphaned. Dangling rows dim; only they can be reaped. Phase 1: engine volume ls/inspect.
export function VolumesView({ live }: { live: boolean }) {
  const [sel, setSel] = useState(0);
  const [pulse, setPulse] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const sound = useSound();
  const selected = VOLUMES[Math.min(sel, VOLUMES.length - 1)];

  const dangling = VOLUMES.filter((v) => isDangling(v));
  const reclaimable = fmtMb(dangling.reduce((sum, v) => sum + mb(v.size), 0));

  const inspect = () => {
    if (!selected) return;
    setPulse(selected.name);
    sound.play("confirm");
    setTimeout(() => setPulse(null), 620);
  };
  const runRemove = (name: string) => {
    setPulse(name);
    sound.play("error");
    setTimeout(() => setPulse(null), 620);
  };
  const armRemove = () => {
    if (!selected || !isDangling(selected)) return;
    setPending({
      question: `REMOVE VOLUME ${selected.name.toUpperCase()}?`,
      label: "REMOVE",
      detail: `deletes the rail and its ${selected.size} of data · unrecoverable.`,
      danger: true,
      run: () => runRemove(selected.name),
    });
  };

  useEffect(() => {
    if (!live || pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "x") armRemove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- armRemove closes over current selection
  }, [live, pending, selected]);

  const above = [
    <span className="volumes__band" key="band">
      VOLUME STORE · <b>{VOLUMES.length}</b> VOLUMES ·{" "}
      <span className="ink--warn">{dangling.length} DANGLING</span> · RECLAIMABLE{" "}
      <b>{reclaimable}</b>
    </span>,
    <span key="g"> </span>,
  ];

  return (
    <div className="volumes">
      <TuiTable<Volume>
        head={HEAD}
        rows={VOLUMES}
        sel={sel}
        onSel={setSel}
        onOpen={() => inspect()}
        active={live && !pending}
        above={above}
        renderRow={(v, isSel, i) => {
          const dang = isDangling(v);
          const usedBy = dang ? "— dangling" : v.usedBy.join(",");
          const hit = pulse === v.name;
          return (
            <button
              key={v.name}
              className={`volrow ${isSel ? "volrow--sel" : ""} ${dang ? "volrow--dangling" : ""} ${hit ? "volrow--pulse" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => setSel(i)}
            >
              {isSel ? "▸" : " "} {pad(v.name, 24)} {pad(v.driver, 8)} {pad(v.size, 7)}{" "}
              <span className={dang ? "ink--dim" : ""}>{pad(usedBy, 20)}</span> {v.created}
            </button>
          );
        }}
      />
      <Rule tone="dim" />
      {pending ? (
        <ConfirmStrip pending={pending} onDone={() => setPending(null)} />
      ) : (
        <ActionBar
          lead={<span>▸ {selected?.name ?? "—"}</span>}
          items={[
            { key: "↵", label: "INSPECT", onRun: () => inspect() },
            {
              key: "X",
              label: "REMOVE",
              onRun: armRemove,
              danger: true,
              disabled: !selected || !isDangling(selected),
            },
          ]}
        />
      )}
    </div>
  );
}
