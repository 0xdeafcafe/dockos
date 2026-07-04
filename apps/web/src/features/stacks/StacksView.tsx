import { useEffect, useState } from "react";
import { TuiTable } from "../../ui/table.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { ConfirmStrip } from "../../ui/confirm.tsx";
import type { Pending } from "../../ui/confirm.tsx";
import { Rule } from "../../ui/text.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import type { Profile } from "../../data/mock.ts";
import { adaptStacks } from "../../rpc/adapt.ts";
import { useRpcAction, useRpcQuery } from "../../rpc/hooks.ts";
import { useSound } from "../../sound/SoundProvider.tsx";
import { Pong } from "../games/Pong.tsx";
import "./stacks.css";

const GLYPH = { up: "● UP     ", partial: "◐ PARTIAL", down: "○ DOWN   " } as const;
const HEAD = "  PROFILE      STATE      SERVICES   CPU    MEM";

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

// Compose profiles on the shared TuiTable: j/k move, ↵ toggles up/down, the action bar
// carries the rest. Phase 0: actions pulse the row (no engine yet); phase 1 wires them
// to `docker compose --profile <p> …`.
export function StacksView({ live }: { live: boolean }) {
  const [sel, setSel] = useState(1);
  const [pulse, setPulse] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pong, setPong] = useState(false);
  const sound = useSound();
  const { data } = useRpcQuery("stacks.list", {}, { pollMs: 3000 });
  const { run } = useRpcAction();
  const stacks = data ? adaptStacks(data) : [];
  const selected = stacks[Math.min(sel, Math.max(0, stacks.length - 1))];

  // up/down hit the engine via stacks.up/down; restart/pull have no contract method yet, so they
  // stay pulse-only (documented gap).
  const act = (verb: "up" | "down" | "restart" | "pull") => {
    if (!selected) return;
    if (verb === "up") void run("stacks.up", { name: selected.name });
    else if (verb === "down") void run("stacks.down", { name: selected.name });
    setPulse(selected.name);
    sound.play(verb === "down" ? "error" : "confirm");
    setTimeout(() => setPulse(null), 620);
  };
  // taking a stack down (or bouncing it) gets the same [Y/N] beat as unit kills
  const arm = (verb: "down" | "restart") => {
    if (!selected) return;
    setPending({
      question:
        verb === "down"
          ? `TAKE STACK ${selected.name.toUpperCase()} DOWN?`
          : `BOUNCE STACK ${selected.name.toUpperCase()}?`,
      label: verb.toUpperCase(),
      detail:
        verb === "down"
          ? `stops every service in the ${selected.name} profile.`
          : `restarts every service in the ${selected.name} profile.`,
      danger: verb === "down",
      run: () => act(verb),
    });
  };

  useEffect(() => {
    if (!live || pending || pong) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "u") act("pull");
      else if (e.key === "r") arm("restart");
      else if (e.key === "d") arm("down");
      else if (e.key === "p") setPong(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- act closes over current selection
  }, [live, pending, pong, selected]);

  // while a game runs, flatten the tube (the SVG barrel re-filters per game frame otherwise)
  useEffect(() => {
    const root = document.documentElement;
    if (pong) root.dataset.crtGame = "1";
    else delete root.dataset.crtGame;
    return () => {
      delete root.dataset.crtGame;
    };
  }, [pong]);

  // PONG.SYS — the deck's idle diagnostic, tucked on the stacks page
  if (pong) {
    return (
      <div className="stacks">
        <Pong active={live} onExit={() => setPong(false)} />
      </div>
    );
  }

  const above = [
    <span className="stacks__dim" key="band">
      COMPOSE PROJECT <b>homelab</b> · stack/compose.yaml · 39 SERVICES · 5 PROFILES
    </span>,
    <span key="g1"> </span>,
  ];
  const below = selected
    ? [
        <span key="g2"> </span>,
        <span className="stacks__cmd" key="cmd">
          → docker compose --profile {selected.name.replaceAll(/[()]/gu, "")} up -d
        </span>,
        ...(selected.note
          ? [
              <span className="stacks__note" key="note">
                {"  "}! {selected.note}
              </span>,
            ]
          : []),
      ]
    : [];

  return (
    <div className="stacks">
      <TuiTable<Profile>
        head={HEAD}
        rows={stacks}
        sel={sel}
        onSel={setSel}
        onOpen={(p) => (p.state === "down" ? act("up") : arm("down"))}
        active={live && !pending}
        above={above}
        below={below}
        renderRow={(p, isSel, i) => (
          <button
            key={p.name}
            className={`strow ${isSel ? "strow--sel" : ""} ${pulse === p.name ? "strow--pulse" : ""}`}
            onMouseEnter={() => setSel(i)}
            onClick={() => setSel(i)}
          >
            {isSel ? "▸" : " "} {pad(p.name, 12)}{" "}
            <span className={`strow__${p.state}`}>{GLYPH[p.state]}</span> {pad(p.services, 10)}{" "}
            {pad(p.cpu, 6)} {pad(p.mem, 7)}
          </button>
        )}
      />
      <Rule tone="dim" />
      {pending ? (
        <ConfirmStrip pending={pending} onDone={() => setPending(null)} />
      ) : (
        <ActionBar
          lead={<span>▸ {selected?.name ?? "—"}</span>}
          items={[
            {
              key: "↵",
              label: selected?.state === "down" ? "UP" : "DOWN",
              onRun: () => (selected?.state === "down" ? act("up") : arm("down")),
            },
            { key: "R", label: "RESTART", onRun: () => arm("restart") },
            { key: "U", label: "PULL", onRun: () => act("pull") },
            { key: "D", label: "DOWN", onRun: () => arm("down"), danger: true },
            { key: "P", label: "PONG.SYS", onRun: () => setPong(true) },
          ]}
        />
      )}
    </div>
  );
}
