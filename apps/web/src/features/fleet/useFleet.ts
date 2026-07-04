import { useEffect, useRef, useState } from "react";
import type { Container } from "../../data/mock.ts";
import { adaptFleet } from "../../rpc/adapt.ts";
import { useRpcAction, useRpcQuery } from "../../rpc/hooks.ts";

export type FxKind = "kill" | "restart" | "pause";

export interface Fx {
  id: string;
  kind: FxKind;
  phase: "shatter" | "rebuild" | "crawl" | "ash";
}

export interface FleetEvent {
  id: number;
  time: string;
  text: string;
}

function now(): string {
  return new Date().toLocaleTimeString("en-GB");
}

function reduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Live fleet, driven by containers.list on a 2s poll, plus the SUPERHOT mutation choreography:
//   kill    → row decays to ash and the gap closes (the unit is tombstoned off the manifest)
//   restart → shatter, then TIME-REWINDS back together
//   pause   → slow-motion crawl to frozen (its sparklines stop — time stands still)
// Each verb fires the real RPC action and lets the poll reconcile; an optimistic override holds
// the new state visible until the server's next list agrees. Under prefers-reduced-motion every
// mutation applies instantly.
export function useFleet() {
  const { data } = useRpcQuery("containers.list", {}, { pollMs: 2000 });
  const { run } = useRpcAction();
  const [fleet, setFleet] = useState<Container[]>([]);
  const [fx, setFx] = useState<Fx | null>(null);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  // killed ids stay off the manifest; optimistic overrides carry a just-issued restart/pause
  // state until the poll reports the server has caught up.
  const killed = useRef<Set<string>>(new Set());
  const overrides = useRef<Map<string, Partial<Container>>>(new Map());
  const names = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!data) return;
    const incoming = adaptFleet(data);
    for (const c of incoming) names.current.set(c.id, c.name);
    setFleet(
      incoming
        .filter((c) => !killed.current.has(c.id))
        .map((c) => {
          const ov = overrides.current.get(c.id);
          if (ov === undefined) return c;
          if (ov.state !== undefined && ov.state === c.state) {
            overrides.current.delete(c.id);
            return c;
          }
          return Object.assign({}, c, ov);
        }),
    );
  }, [data]);

  const nameOf = (id: string) => names.current.get(id) ?? id;
  const log = (id: string, verb: string) =>
    setEvents((e) => [
      ...e.slice(-30),
      { id: (e.at(-1)?.id ?? 0) + 1, time: now(), text: `${nameOf(id)} ${verb}` },
    ]);

  const kill = (id: string) => {
    log(id, "terminated · unit removed from manifest");
    void run("containers.kill", { id });
    killed.current.add(id);
    const remove = () => setFleet((f) => f.filter((c) => c.id !== id));
    if (reduceMotion()) return remove();
    setFx({ id, kind: "kill", phase: "ash" });
    setTimeout(() => {
      remove();
      setFx(null);
    }, 520);
  };

  const restart = (id: string) => {
    log(id, "restarted · uptime reset");
    void run("containers.restart", { id });
    overrides.current.set(id, { state: "up", uptime: "0s" });
    const apply = () =>
      setFleet((f) => f.map((c) => (c.id === id ? { ...c, state: "up", uptime: "0s" } : c)));
    if (reduceMotion()) return apply();
    setFx({ id, kind: "restart", phase: "shatter" });
    setTimeout(() => setFx({ id, kind: "restart", phase: "rebuild" }), 380);
    setTimeout(() => {
      apply();
      setFx(null);
    }, 1050);
  };

  const pause = (id: string) => {
    log(id, "suspension toggled");
    void run("containers.pause", { id });
    const next: Container["state"] =
      fleet.find((c) => c.id === id)?.state === "paused" ? "up" : "paused";
    overrides.current.set(id, { state: next });
    const apply = () =>
      setFleet((f) => f.map((c) => (c.id === id ? { ...c, state: next } : c)));
    if (reduceMotion()) return apply();
    setFx({ id, kind: "pause", phase: "crawl" });
    setTimeout(() => {
      apply();
      setFx(null);
    }, 850);
  };

  return { fleet, fx, events, kill, restart, pause };
}

export type FleetApi = ReturnType<typeof useFleet>;
