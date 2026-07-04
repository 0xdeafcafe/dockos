import { useEffect, useState } from "react";
import { TuiTable } from "../../ui/table.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { ConfirmStrip } from "../../ui/confirm.tsx";
import type { Pending } from "../../ui/confirm.tsx";
import { Rule } from "../../ui/text.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import { IMAGES } from "../../data/mock.ts";
import type { ImageAudit } from "../../data/mock.ts";
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

// A deterministic short digest so every row reads like a real image id without a backend.
function idOf(img: ImageAudit): string {
  let h = 0;
  for (const ch of img.repo + img.current) h = Math.trunc((h * 33 + (ch.codePointAt(0) ?? 0)) % 1e9);
  return "sha256:" + Math.abs(h).toString(16).padStart(8, "0").slice(0, 8);
}

const AGES = ["3d", "14d", "2d", "9d", "5d", "6h", "11d", "27d", "4d", "2d", "18d", "2d"];
function ageOf(i: number): string {
  return AGES[i % AGES.length] ?? "—";
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

function cveText(img: ImageAudit): { text: string; cls: string } {
  const { crit, high, med } = img.cves;
  const text = `${crit}/${high}/${med}`.padEnd(10);
  if (crit > 0) return { text, cls: "ink--err" };
  if (high > 0) return { text, cls: "ink--warn" };
  return { text, cls: "ink--dim" };
}

const HEAD = `  ${pad("REPO:TAG", 30)} ${pad("IMAGE ID", 15)} ${pad("SIZE", 7)} ${pad("AGE", 6)} ${pad("CVE C/H/M", 10)} FLAG`;

// IMAGES: every layer on the disk — what's tagged, how big, how old, what CVEs it carries,
// and which rails to reap. PRUNE clears untagged layers; PURGE removes the selected image
// outright. Phase 1: engine image ls / rm / prune + trivy/grype scan.
export function ImagesView({ live }: { live: boolean }) {
  const [sel, setSel] = useState(0);
  const [pulse, setPulse] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const sound = useSound();
  const selected = IMAGES[Math.min(sel, IMAGES.length - 1)];

  const dangling = IMAGES.filter((i) => isDangling(i));
  const reclaimable = fmtMb(dangling.reduce((sum, i) => sum + mb(i.size), 0));

  const flash = (token: string, sfx: "confirm" | "error" = "confirm") => {
    setPulse(token);
    sound.play(sfx);
    setTimeout(() => setPulse(null), 620);
  };
  const act = (verb: "inspect" | "pull") => {
    if (!selected) return;
    flash(selected.repo);
    void verb;
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
      if (e.key === "u") act("pull");
      else if (e.key === "x") armPrune();
      else if (e.key === "d") armPurge();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- handlers close over current selection
  }, [live, pending, selected, dangling.length]);

  const above = [
    <span className="images__band" key="band">
      IMAGE STORE · <b>{IMAGES.length}</b> IMAGES ·{" "}
      <span className="ink--warn">{dangling.length} DANGLING</span> · RECLAIMABLE{" "}
      <b>{reclaimable}</b>
    </span>,
    <span key="g"> </span>,
  ];

  return (
    <div className="images">
      <TuiTable<ImageAudit>
        head={HEAD}
        rows={IMAGES}
        sel={sel}
        onSel={setSel}
        onOpen={() => act("inspect")}
        active={live && !pending}
        above={above}
        renderRow={(img, isSel, i) => {
          const cve = cveText(img);
          const dang = isDangling(img);
          const hit = pulse === img.repo || (pulse === PRUNE && dang);
          return (
            <button
              key={img.repo}
              className={`imgrow ${isSel ? "imgrow--sel" : ""} ${hit ? "imgrow--pulse" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => setSel(i)}
            >
              {isSel ? "▸" : " "} {pad(`${img.repo}:${img.tag}`, 30)} {pad(idOf(img), 15)}{" "}
              {pad(img.size, 7)} {pad(ageOf(i), 6)} <span className={cve.cls}>{cve.text}</span>{" "}
              {dang ? (
                <span className="ink--warn">◆ DANGLING</span>
              ) : (
                <span className="ink--dim">—</span>
              )}
            </button>
          );
        }}
      />
      <Rule tone="dim" />
      {pending ? (
        <ConfirmStrip pending={pending} onDone={() => setPending(null)} />
      ) : (
        <ActionBar
          lead={<span>▸ {selected?.repo ?? "—"}</span>}
          items={[
            { key: "↵", label: "INSPECT", onRun: () => act("inspect") },
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
