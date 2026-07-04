import { useState } from "react";
import { useRpcQuery } from "../../rpc/hooks.ts";
import { TermScroll } from "../../ui/scroll.tsx";
import "./files.css";

// Read-only filesystem browse over the engine ARCHIVE api (docker cp out) — never exec. Directories
// and file previews come from containers.files / containers.file; big trees/files come back marked
// truncated (the archive of a path is its whole subtree, read under a cap).

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return `${n}B`;
}
function parentOf(p: string): string {
  if (p === "/" || p === "") return "/";
  const i = p.replace(/\/$/u, "").lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}
function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}
function pad(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

export function FilesTab({ containerId }: { containerId: string }) {
  const [path, setPath] = useState("/");
  const [file, setFile] = useState<string | null>(null);
  const { data: dir } = useRpcQuery("containers.files", { id: containerId, path }, {});
  const { data: content } = useRpcQuery(
    "containers.file",
    { id: containerId, path: file ?? "" },
    { enabled: file !== null },
  );
  const entries = dir?.entries ?? [];

  const openDir = (name: string) => {
    setFile(null);
    setPath(join(path, name));
  };

  const listLines = [
    <button className="filerow filerow--up" key="__up" onClick={() => setPath(parentOf(path))}>
      ▸ .. {path === "/" ? "(root)" : "UP"}
    </button>,
    ...(dir?.truncated
      ? [
          <div className="files__trunc" key="__tr">
            ⌁ large directory — listing truncated
          </div>,
        ]
      : []),
    ...entries.map((e) => {
      const isDir = e.type === "dir";
      return (
        <button
          key={e.name}
          className={`filerow ${e.type === "link" ? "filerow--link" : ""}`}
          onClick={() => (isDir ? openDir(e.name) : setFile(join(path, e.name)))}
        >
          {isDir ? "▸ " : "  "}
          {pad(`${e.name}${isDir ? "/" : ""}`, 42)}
          <span className="files__meta">
            {isDir ? "" : e.type === "link" ? "↗ link" : fmtSize(e.size)}
          </span>
        </button>
      );
    }),
  ];

  return (
    <div className="files">
      <div className="files__band">
        <span className="files__path">◈ {path}</span>
        <span className="detail__dim">
          {entries.length} ENTRIES · read-only · archive api · no exec
        </span>
      </div>
      <div className="files__cols">
        <div className="files__list">
          <TermScroll lines={listLines} />
        </div>
        {file !== null ? (
          <div className="files__preview">
            <div className="files__band">
              <span className="files__path">▤ {file}</span>
              <button className="files__close" onClick={() => setFile(null)}>
                [× CLOSE]
              </button>
            </div>
            {content?.binary ? (
              <div className="detail__dim"> — binary file · not previewable —</div>
            ) : (
              <TermScroll
                lines={(content?.content ?? "…").split("\n").map((l, i) => (
                  // oxlint-disable-next-line react/no-array-index-key -- file rows are positional
                  <span className="fileline" key={i}>
                    {l || " "}
                  </span>
                ))}
              />
            )}
            {content?.truncated ? <div className="files__trunc">⌁ preview truncated</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
