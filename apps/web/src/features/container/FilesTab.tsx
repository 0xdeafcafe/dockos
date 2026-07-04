import { useEffect, useMemo, useState } from "react";
import { TermScroll } from "../../ui/scroll.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import { fmtSize, fsFor, isTextPreview } from "./fsmock.ts";
import type { FsNode } from "./fsmock.ts";
import "./files.css";

// FILES — a tree browser over the container's fs. Phase 0 walks the mock tree;
// phase 1 swaps fsFor() for `docker exec ls`-shaped RPC and keeps this view intact.

const NAME_W = 42; // tree rails + glyph + name + ▤ live in this column
const PREVIEW_ROWS = 8;

interface Row {
  node: FsNode;
  path: string; // /config/config.yml
  depth: number;
  rail: string; // "│   └── "
  open: boolean; // dirs: currently expanded
  parent: number; // index of parent row, -1 at root
}

function flatten(roots: FsNode[], expanded: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const walk = (nodes: FsNode[], prefix: string, base: string, depth: number, parent: number) => {
    nodes.forEach((n, i) => {
      const last = i === nodes.length - 1;
      const path = `${base}/${n.name}`;
      const open = n.kind === "dir" && expanded.has(path);
      const at =
        out.push({ node: n, path, depth, rail: prefix + (last ? "└── " : "├── "), open, parent }) -
        1;
      if (open && n.children) walk(n.children, prefix + (last ? "    " : "│   "), path, depth + 1, at);
    });
  };
  walk(roots, "", "", 0, -1);
  return out;
}

function FileRow({
  row,
  selected,
  onHover,
  onOpen,
}: {
  row: Row;
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const n = row.node;
  const glyph = n.kind === "dir" ? (row.open ? "▾" : "▸") : "·";
  const mount = n.mounted ? " ▤" : "";
  const lead = row.rail.length + 2; // glyph + space
  let name = row.depth === 0 ? `/${n.name}` : n.name;
  const maxName = NAME_W - lead - mount.length;
  if (name.length > maxName) name = name.slice(0, Math.max(1, maxName - 1)) + "…";
  const fill = " ".repeat(Math.max(1, NAME_W - lead - name.length - mount.length));
  const cls = ["files__row", selected && "files__row--sel"];
  return (
    <button className={cls.filter(Boolean).join(" ")} onMouseEnter={onHover} onClick={onOpen}>
      <span className="files__rail">{row.rail}</span>
      <span className={n.kind === "dir" ? "files__dir" : "files__file"}>{glyph}</span>{" "}
      <span className={n.kind === "dir" ? "files__dirname" : "files__name"}>{name}</span>
      {n.mounted ? <span className="files__mount"> ▤</span> : null}
      {fill}
      <span className="files__meta">
        {n.mode}
        {"  "}
        {fmtSize(n.size).padStart(6)}
        {"  "}
        {n.mtime.padStart(12)}
      </span>
    </button>
  );
}

function Preview({ row }: { row: Row }) {
  const n = row.node;
  const text = isTextPreview(n);
  const tail = text ? (n.lines ?? []).slice(-PREVIEW_ROWS) : [];
  return (
    <div className="files__preview">
      <div className="files__phead">
        {`── ${row.path} ── ${fmtSize(n.size)} ${"─".repeat(190)}`}
      </div>
      {text ? (
        tail.map((line, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- preview rows ARE positional slots
          <div className="files__pline" key={i}>
            {line}
          </div>
        ))
      ) : (
        <div className="files__pline files__pbin">▓▓ BINARY · {fmtSize(n.size)} ▓▓</div>
      )}
    </div>
  );
}

export function FilesTab({ containerName, live }: { containerName: string; live: boolean }) {
  const roots = useMemo(() => fsFor(containerName), [containerName]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(["/config"]));
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<Row | null>(null);

  // fresh unit, fresh browser — a stale preview from another container breaks the fiction
  useEffect(() => {
    setCursor(0);
    setPreview(null);
    setExpanded(new Set(["/config"]));
  }, [containerName]);

  const rows = useMemo(() => flatten(roots, expanded), [roots, expanded]);
  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const current = rows[at] ?? null;

  const toggleDir = (row: Row) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(row.path)) next.delete(row.path);
      else next.add(row.path);
      return next;
    });

  // ↵/→/click: dirs toggle, files preview (previewing again closes it)
  const openRow = (row: Row, i: number) => {
    setCursor(i);
    if (row.node.kind === "dir") toggleDir(row);
    else setPreview((p) => (p?.path === row.path ? null : row));
  };

  // ←/h: collapse an open dir, otherwise climb to the parent row
  const upRow = (row: Row) => {
    if (row.open) toggleDir(row);
    else if (row.parent >= 0) setCursor(row.parent);
  };

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      if (e.key === "j" || e.key === "ArrowDown") setCursor(Math.min(rows.length - 1, at + 1));
      else if (e.key === "k" || e.key === "ArrowUp") setCursor(Math.max(0, at - 1));
      else if (e.key === "g") setCursor(0);
      else if (e.key === "G") setCursor(Math.max(0, rows.length - 1));
      else if ((e.key === "l" || e.key === "ArrowRight" || e.key === "Enter") && current)
        openRow(current, at);
      else if ((e.key === "h" || e.key === "ArrowLeft") && current) upRow(current);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- openRow/upRow close over rows+at
  }, [live, rows, at, current]);

  // breadcrumb speaks the cursor's directory: the dir itself, or a file's parent
  let dirPath = "/";
  let entries = roots;
  if (current) {
    if (current.node.kind === "dir") {
      dirPath = `${current.path}/`;
      entries = current.node.children ?? [];
    } else if (current.parent >= 0) {
      const parent = rows[current.parent];
      if (parent?.node.children) {
        dirPath = `${parent.path}/`;
        entries = parent.node.children;
      }
    }
  }
  const dirCount = entries.filter((n) => n.kind === "dir").length;

  return (
    <>
      <div className="files__band">
        <span className="files__label">PATH</span>
        <span className="files__path">{dirPath}</span>
        <span className="files__count">
          {entries.length} ENTRIES · {dirCount} DIRS
        </span>
      </div>
      <TermScroll
        lines={rows.map((row, i) => (
          <FileRow
            key={row.path}
            row={row}
            selected={i === at}
            onHover={() => setCursor(i)}
            onOpen={() => openRow(row, i)}
          />
        ))}
      />
      {preview ? <Preview row={preview} /> : null}
      <div className="files__hint">
        <span className="files__key">[J/K]</span> MOVE · <span className="files__key">[↵/→]</span>{" "}
        OPEN · <span className="files__key">[←]</span> UP · mounts marked{" "}
        <span className="files__mount">▤</span>
      </div>
    </>
  );
}
