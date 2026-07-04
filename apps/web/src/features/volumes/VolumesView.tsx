import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { TuiTable } from "../../ui/table.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { ConfirmStrip } from "../../ui/confirm.tsx";
import type { Pending } from "../../ui/confirm.tsx";
import { Box } from "../../ui/box.tsx";
import { Rule, Text } from "../../ui/text.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import type { Volume } from "@dockos/contract";
import { useRpcQuery } from "../../rpc/hooks.ts";
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

// one labelled line in the inspect strip — dim key gutter, value takes the rest and wraps
// long tokens (mountpoints run deep) without ever spilling the pane.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="voldetail__row">
      <span className="voldetail__key">{label}</span>
      <span className="voldetail__val">{children}</span>
    </div>
  );
}

const HEAD = `  ${pad("NAME", 24)} ${pad("DRIVER", 8)} ${pad("SIZE", 7)} ${pad("USED BY", 20)} AGE`;

// volumes: the persistent rails — what's mounted where, how big, and which have been
// orphaned. Dangling rows dim; only they can be reaped. Phase 1: engine volume ls/inspect.
export function VolumesView({ live }: { live: boolean }) {
  const [sel, setSel] = useState(0);
  const [pulse, setPulse] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const sound = useSound();
  const { data } = useRpcQuery("volumes.list", {}, live ? { pollMs: 5000 } : {});
  const volumes = data?.volumes ?? [];
  const selected = volumes[Math.min(sel, volumes.length - 1)];

  const dangling = volumes.filter((v) => isDangling(v));
  const reclaimable = fmtMb(dangling.reduce((sum, v) => sum + mb(v.size), 0));

  // INSPECT toggles the detail strip below the table. Opening pulses the row so the eye
  // ties the highlighted rail to the fields now shown beneath it; the panel then follows
  // the cursor (reads `selected`), so j/k walks the store with the strip live.
  const inspect = () => {
    if (!selected) return;
    sound.play("confirm");
    if (!detail) {
      setPulse(selected.name);
      setTimeout(() => setPulse(null), 620);
    }
    setDetail((open) => !open);
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
      // Esc folds the strip shut — captured + stopped so the shell's global back() (which
      // also owns Esc) never fires past a panel that's just closing.
      if (e.key === "Escape" && detail) {
        setDetail(false);
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "x") armRemove();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- armRemove closes over current selection
  }, [live, pending, selected, detail]);

  const above = [
    <span className="volumes__band" key="band">
      VOLUME STORE · <b>{volumes.length}</b> VOLUMES ·{" "}
      <span className="ink--warn">{dangling.length} DANGLING</span> · RECLAIMABLE{" "}
      <b>{reclaimable}</b>
    </span>,
    <span key="g"> </span>,
  ];

  return (
    <div className="volumes">
      <TuiTable<Volume>
        head={HEAD}
        rows={volumes}
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
              // click on the hovered row opens INSPECT (mouse users needn't press ↵ / find the bar)
              onClick={() => (isSel ? inspect() : setSel(i))}
            >
              {isSel ? "▸" : " "} {pad(v.name, 24)} {pad(v.driver, 8)} {pad(v.size, 7)}{" "}
              <span className={dang ? "ink--dim" : ""}>{pad(usedBy, 20)}</span> {v.created}
            </button>
          );
        }}
      />
      {detail && selected ? (
        <div className="voldetail">
          <Box
            title={<Text tone="accent">◈ INSPECT · {selected.name}</Text>}
            border="double"
            tone="accent"
            actions={<span>ESC · CLOSE</span>}
          >
            <Field label="NAME">{selected.name}</Field>
            <Field label="DRIVER">{selected.driver}</Field>
            <Field label="MOUNTPOINT">
              <span className="voldetail__path">{selected.mountpoint}</span>
            </Field>
            <Field label="USED BY">
              {isDangling(selected) ? (
                <Text tone="dim">— no containers —</Text>
              ) : (
                selected.usedBy.join(" · ")
              )}
            </Field>
            <Field label="CREATED">{selected.created}</Field>
            <Field label="STATE">
              {isDangling(selected) ? (
                <Text tone="warn">◆ DANGLING · orphaned · reclaimable</Text>
              ) : (
                <Text tone="ok">
                  ● IN USE · {selected.usedBy.length} container
                  {selected.usedBy.length === 1 ? "" : "s"}
                </Text>
              )}
            </Field>
          </Box>
        </div>
      ) : null}
      <Rule tone="dim" />
      {pending ? (
        <ConfirmStrip pending={pending} onDone={() => setPending(null)} />
      ) : (
        <ActionBar
          lead={<span>▸ {selected?.name ?? "—"}</span>}
          items={[
            {
              key: detail ? "ESC" : "↵",
              label: detail ? "CLOSE" : "INSPECT",
              onRun: () => inspect(),
            },
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
