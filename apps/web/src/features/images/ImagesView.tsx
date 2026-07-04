import { useEffect, useState } from "react";
import { TuiTable } from "../../ui/table.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { ConfirmStrip } from "../../ui/confirm.tsx";
import type { Pending } from "../../ui/confirm.tsx";
import { Rule } from "../../ui/text.tsx";
import { Box } from "../../ui/box.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import type { Image as ImageAudit } from "@dockos/contract";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { useSound } from "../../sound/SoundProvider.tsx";
import "./images.css";

const PRUNE = "__prune__";

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

// stale = untagged / unknown upstream: the phase-0 stand-in for a dangling <none> image.
// Phase 1 reads the real Dangling flag off `docker image ls -f dangling=true`.
function isDangling(img: ImageAudit): boolean {
  return img.status === "stale";
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

function cveClass(img: ImageAudit): string {
  const { crit, high } = img.cves;
  if (crit > 0) return "ink--err";
  if (high > 0) return "ink--warn";
  return "ink--dim";
}
function cveText(img: ImageAudit): { text: string; cls: string } {
  const { crit, high, med } = img.cves;
  return { text: `${crit}/${high}/${med}`.padEnd(10), cls: cveClass(img) };
}

// STATUS badge for the inspect panel — dangling (stale) reads as the reapable ◆ state, an
// outdated tag as ○, an up-to-date tag as ●. Mirrors the FLAG column's language.
function statusMeta(img: ImageAudit): { glyph: string; text: string; cls: string } {
  if (isDangling(img)) return { glyph: "◆", text: "DANGLING", cls: "ink--warn" };
  if (img.status === "outdated") return { glyph: "○", text: "OUTDATED", cls: "ink--warn" };
  return { glyph: "●", text: "CURRENT", cls: "ink--ok" };
}

function Field({ label, val }: { label: string; val: string }) {
  return (
    <div className="imgdetail__row">
      <span className="ink--dim">{label.padEnd(11)}</span>
      {val}
    </div>
  );
}

// INSPECT: a framed register strip below the table. Reads straight off the selected Image —
// no extra RPC — so it tracks the cursor as j/k moves. ↵ / ESC (or the CLOSE cap) dismisses it.
function InspectPanel({
  img,
  showCve,
  onClose,
}: {
  img: ImageAudit;
  showCve: boolean;
  onClose: () => void;
}) {
  const st = statusMeta(img);
  const { crit, high, med } = img.cves;
  const version = img.current === img.latest ? img.current : `${img.current} → ${img.latest}`;
  return (
    <div className="imgdetail">
      <Box title={`INSPECT · ${img.repo}:${img.tag}`} focus>
        <Field label="REPO:TAG" val={`${img.repo}:${img.tag}`} />
        <Field label="IMAGE ID" val={img.id} />
        <Field label="SIZE" val={img.size} />
        <Field label="AGE" val={img.age} />
        <Field label="VERSION" val={version} />
        <div className="imgdetail__row">
          <span className="ink--dim">{"STATUS".padEnd(11)}</span>
          <span className={st.cls}>
            {st.glyph} {st.text}
          </span>
        </div>
        {showCve ? (
          <div className="imgdetail__row">
            <span className="ink--dim">{"CVE C/H/M".padEnd(11)}</span>
            <span className={cveClass(img)}>{`${crit}/${high}/${med}`}</span>
          </div>
        ) : null}
        <button className="imgdetail__close" onClick={onClose}>
          {"↵ / ESC · CLOSE"}
        </button>
      </Box>
    </div>
  );
}

function headFor(showCve: boolean): string {
  return `  ${pad("REPO:TAG", 30)} ${pad("IMAGE ID", 15)} ${pad("SIZE", 7)} ${pad("AGE", 6)} ${
    showCve ? pad("CVE C/H/M", 10) + " " : ""
  }FLAG`;
}

// images: every layer on the disk — what's tagged, how big, how old, what CVEs it carries,
// and which rails to reap. PRUNE clears untagged layers; PURGE removes the selected image
// outright. Phase 1: engine image ls / rm / prune + trivy/grype scan.
export function ImagesView({ live }: { live: boolean }) {
  const [sel, setSel] = useState(0);
  const [pulse, setPulse] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [inspect, setInspect] = useState(false);
  const sound = useSound();
  const { data } = useRpcQuery("images.list", {}, live ? { pollMs: 5000 } : {});
  const images = data?.images ?? [];
  const { data: cfg } = useRpcQuery("config.get", {}, {});
  const showCve = cfg?.cve ?? false;
  const selected = images[Math.min(sel, images.length - 1)];

  const dangling = images.filter((i) => isDangling(i));
  const reclaimable = fmtMb(dangling.reduce((sum, i) => sum + mb(i.size), 0));

  const flash = (token: string, sfx: "confirm" | "error" = "confirm") => {
    setPulse(token);
    sound.play(sfx);
    setTimeout(() => setPulse(null), 620);
  };
  const act = (verb: "inspect" | "pull") => {
    if (!selected) return;
    if (verb === "inspect") {
      setInspect((open) => !open);
      sound.play("confirm");
      return;
    }
    flash(selected.repo);
  };
  const armPrune = () => {
    if (dangling.length === 0) return;
    setPending({
      question: `PRUNE ${dangling.length} DANGLING IMAGE${dangling.length === 1 ? "" : "S"}?`,
      label: "PRUNE",
      detail: `removes untagged layers · reclaims ${reclaimable}.`,
      danger: true,
      run: () => flash(PRUNE, "error"),
    });
  };
  const armPurge = () => {
    if (!selected) return;
    const target = selected;
    setPending({
      question: `PURGE IMAGE ${target.repo}:${target.tag}?`,
      label: "PURGE",
      detail: `deletes the image and frees ${target.size} · running containers must be stopped.`,
      danger: true,
      run: () => flash(target.repo, "error"),
    });
  };

  useEffect(() => {
    if (!live || pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "Escape") {
        if (inspect) setInspect(false);
      } else if (e.key === "u") act("pull");
      else if (e.key === "x") armPrune();
      else if (e.key === "d") armPurge();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- handlers close over current selection
  }, [live, pending, selected, dangling.length, inspect]);

  const above = [
    <span className="images__band" key="band">
      IMAGE STORE · <b>{images.length}</b> IMAGES ·{" "}
      <span className="ink--warn">{dangling.length} DANGLING</span> · RECLAIMABLE{" "}
      <b>{reclaimable}</b>
    </span>,
    <span key="g"> </span>,
  ];

  return (
    <div className="images">
      <TuiTable<ImageAudit>
        head={headFor(showCve)}
        rows={images}
        sel={sel}
        onSel={setSel}
        onOpen={() => act("inspect")}
        active={live && !pending}
        above={above}
        renderRow={(img, isSel, i) => {
          const cve = showCve ? cveText(img) : null;
          const dang = isDangling(img);
          const hit = pulse === img.repo || (pulse === PRUNE && dang);
          return (
            <button
              key={img.id}
              className={`imgrow ${isSel ? "imgrow--sel" : ""} ${hit ? "imgrow--pulse" : ""}`}
              onMouseEnter={() => setSel(i)}
              // hover already selects, so a click on the (hovered) row opens INSPECT — mouse users
              // don't have to find the action bar / press ↵. A click on a not-yet-selected row selects.
              onClick={() => (isSel ? act("inspect") : setSel(i))}
            >
              {isSel ? "▸" : " "} {pad(`${img.repo}:${img.tag}`, 30)} {pad(img.id, 15)}{" "}
              {pad(img.size, 7)} {pad(img.age, 6)}{" "}
              {cve ? (
                <>
                  <span className={cve.cls}>{cve.text}</span>{" "}
                </>
              ) : null}
              {dang ? (
                <span className="ink--warn">◆ DANGLING</span>
              ) : (
                <span className="ink--dim">—</span>
              )}
            </button>
          );
        }}
      />
      {selected && inspect ? (
        <InspectPanel img={selected} showCve={showCve} onClose={() => setInspect(false)} />
      ) : null}
      <Rule tone="dim" />
      {pending ? (
        <ConfirmStrip pending={pending} onDone={() => setPending(null)} />
      ) : (
        <ActionBar
          lead={<span>▸ {selected?.repo ?? "—"}</span>}
          items={[
            { key: "↵", label: inspect ? "CLOSE" : "INSPECT", onRun: () => act("inspect") },
            { key: "U", label: "PULL", onRun: () => act("pull") },
            {
              key: "X",
              label: "PRUNE DANGLING",
              onRun: armPrune,
              danger: true,
              disabled: dangling.length === 0,
            },
            { key: "D", label: "PURGE", onRun: armPurge, danger: true, disabled: !selected },
          ]}
        />
      )}
    </div>
  );
}
