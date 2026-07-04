import { useEffect, useMemo, useRef, useState } from "react";
import { TuiTable } from "../../ui/table.tsx";
import { TuiInput } from "../../ui/input.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { ConfirmStrip } from "../../ui/confirm.tsx";
import type { Pending } from "../../ui/confirm.tsx";
import { WordSlam } from "../../ui/slam.tsx";
import { Rule } from "../../ui/text.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import type { Container } from "../../data/mock.ts";
import { useSound } from "../../sound/SoundProvider.tsx";
import { FleetRow } from "./FleetRow.tsx";
import { Telemetry } from "./Telemetry.tsx";
import type { FleetApi } from "./useFleet.ts";
import "./fleet.css";

type SortKey = "none" | "cpu" | "mem" | "name";
const SORTS: SortKey[] = ["none", "cpu", "mem", "name"];

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

// header cells mirror the row template exactly — labels sit over their data
const HEAD = `  ST ${pad("NAME", 14)} ${pad("STACK", 7)} ${pad("CPU ⌁", 12)} ${pad("  %", 4)} ${pad("MEM ▮", 8)} ${pad("SIZE", 11)} ${pad("NET I/O", 10)} UP`;

function sortFleet(fleet: Container[], key: SortKey): Container[] {
  if (key === "none") return fleet;
  const by = [...fleet];
  if (key === "cpu") by.sort((a, b) => b.cpu - a.cpu);
  else if (key === "mem")
    by.sort((a, b) => (b.memHistory.at(-1) ?? 0) - (a.memHistory.at(-1) ?? 0));
  else by.sort((a, b) => a.name.localeCompare(b.name));
  return by;
}

type Slam = { word: string; tone: "err" | "accent" } | null;

export function FleetView({
  api,
  active,
  preset,
  onOpen,
}: {
  api: FleetApi;
  active: boolean;
  preset?: string | null;
  onOpen: (c: Container) => void;
}) {
  const { fleet, fx, events } = api;
  const sound = useSound();
  const [sel, setSel] = useState(0);
  const [sort, setSort] = useState<SortKey>("none");
  const [filter, setFilter] = useState("");
  const [filterFocus, setFilterFocus] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [slam, setSlam] = useState<Slam>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  // input-intent gate: hover only moves the cursor after a REAL pointer move. Without this,
  // the 1.4s tick re-renders rows and onMouseEnter refires under a stationary cursor —
  // yanking the selection back to the mouse row and fighting keyboard j/k.
  const pointerLive = useRef(false);
  useEffect(() => {
    const onMove = () => (pointerLive.current = true);
    const onKey = () => (pointerLive.current = false);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  const hover = (i: number) => {
    if (pointerLive.current) setSel(i);
  };

  // arriving from a network-area click: land pre-filtered to that zone's units
  useEffect(() => {
    if (preset) setFilter(preset);
  }, [preset]);

  const rows = useMemo(() => {
    const filtered = filter
      ? fleet.filter((c) => `${c.name} ${c.stack}`.toLowerCase().includes(filter.toLowerCase()))
      : fleet;
    return sortFleet(filtered, sort);
  }, [fleet, filter, sort]);

  const clamped = Math.min(sel, Math.max(0, rows.length - 1));
  const current = rows[clamped] ?? null;
  const cycleSort = () => setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length] ?? "none");

  const doKill = (c: Container) => {
    api.kill(c.id);
    setSlam({ word: "TERMINATED", tone: "err" });
    sound.play("error");
  };
  const doRestart = (c: Container) => {
    api.restart(c.id);
    setSlam({ word: "REWIND", tone: "accent" });
    sound.play("confirm");
  };
  const doPause = (c: Container) => {
    api.pause(c.id);
    sound.play("nav");
  };
  // every disruptive verb goes through the same [Y/N] beat (ConfirmStrip owns the keys)
  const armKill = (c: Container) =>
    setPending({
      question: `TERMINATE ${c.name.toUpperCase()}?`,
      label: "TERMINATE",
      detail: "unit is removed from the manifest · named volumes persist.",
      danger: true,
      run: () => doKill(c),
    });
  const armRestart = (c: Container) =>
    setPending({
      question: `REWIND ${c.name.toUpperCase()}?`,
      label: "RESTART",
      detail: "container restarts · uptime resets · brief downtime.",
      run: () => doRestart(c),
    });

  // action keys (nav + ↵ live in TuiTable) — every one has a visible button twin below
  useEffect(() => {
    if (!active || filterFocus || pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "r" && current) armRestart(current);
      else if (e.key === "p" && current) doPause(current);
      else if (e.key === "d" && current) armKill(current);
      else if (e.key === "s") cycleSort();
      else if (e.key === "/") {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- handlers close over stable api
  }, [active, filterFocus, pending, current]);

  return (
    <div className="fleet">
      <div className="fleet__bar">
        <span className="ink--accent">FILTER/</span>
        <TuiInput
          value={filter}
          onChange={setFilter}
          placeholder="name or stack…"
          inputRef={filterRef}
          onFocusChange={setFilterFocus}
          onEnter={() => filterRef.current?.blur()}
        />
        <button className="fleet__sort" onClick={cycleSort}>
          <span className="ink--accent">[S]</span> SORT:{sort.toUpperCase()}
        </button>
        <span className="ink--dim">
          {rows.length}/{fleet.length} UNITS
        </span>
      </div>
      <Rule tone="dim" />
      <TuiTable
        head={HEAD}
        rows={rows}
        sel={clamped}
        onSel={setSel}
        onOpen={onOpen}
        active={active && !filterFocus && !pending}
        empty="— NO UNITS MATCH ▮ —"
        renderRow={(c, selected, i) => (
          <FleetRow
            key={c.id}
            container={c}
            selected={selected}
            fx={fx?.id === c.id ? fx : null}
            onHover={() => hover(i)}
            onOpen={() => onOpen(c)}
          />
        )}
      />
      <Rule tone="dim" />
      {pending ? (
        <ConfirmStrip pending={pending} onDone={() => setPending(null)} />
      ) : (
        <ActionBar
          lead={<span>▸ {current ? current.name : "—"}</span>}
          items={[
            {
              key: "↵",
              label: "INSPECT",
              onRun: () => current && onOpen(current),
              disabled: !current,
            },
            {
              key: "R",
              label: "RESTART",
              onRun: () => current && armRestart(current),
              disabled: !current,
            },
            {
              key: "P",
              label: "PAUSE",
              onRun: () => current && doPause(current),
              disabled: !current,
            },
            {
              key: "D",
              label: "KILL",
              onRun: () => current && armKill(current),
              disabled: !current,
              danger: true,
            },
          ]}
        />
      )}
      <Rule tone="dim" />
      <Telemetry selected={current} events={events} />
      {slam ? <WordSlam word={slam.word} tone={slam.tone} onDone={() => setSlam(null)} /> : null}
    </div>
  );
}
