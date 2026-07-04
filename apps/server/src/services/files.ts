import type { ContainersFileResult, ContainersFilesResult, FsEntry } from "@dockos/contract";
import type { DockerEngine } from "../ports/docker.ts";
import { parseTar } from "../util/tar.ts";

// Read-only filesystem browse over the engine ARCHIVE api (docker cp out) — never exec. The archive
// of a path is a tar of its whole subtree, so a directory listing reads a cap's worth of tar and
// keeps only the immediate children; a file read pulls the single entry. Big dirs/files come back
// `truncated`.
const LIST_CAP = 8 * 1024 * 1024; // up to 8 MiB of tar to enumerate a directory
const FILE_CAP = 1024 * 1024; // up to 1 MiB of a single file

function normalize(p: string): string {
  const clean = (p || "/").replace(/\/+/gu, "/");
  return clean.length > 1 ? clean.replace(/\/$/u, "") : clean;
}

function basename(p: string): string {
  const parts = p.replace(/\/$/u, "").split("/");
  return parts.at(-1) ?? "";
}

function isBinary(b: Buffer): boolean {
  const n = Math.min(b.length, 8000);
  for (let i = 0; i < n; i += 1) if (b[i] === 0) return true;
  return false;
}

export class FilesService {
  private readonly engine: DockerEngine;

  constructor(engine: DockerEngine) {
    this.engine = engine;
  }

  async list(id: string, path: string): Promise<ContainersFilesResult> {
    const dir = normalize(path);
    const { buf, truncated } = await this.engine.containerArchive(id, dir, LIST_CAP);
    const base = basename(dir); // "" for root — archive of "/" has entries like "etc/", "bin/"
    const prefix = base ? `${base}/` : "";
    const seen = new Map<string, FsEntry>();
    for (const e of parseTar(buf)) {
      if (base && (e.name === base || e.name === `${base}/`)) continue; // the dir itself
      const rel = prefix && e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name;
      const child = rel.replace(/\/$/u, "");
      if (!child || child.includes("/")) continue; // only immediate children
      if (!seen.has(child)) {
        seen.set(child, { name: child, type: e.type === "other" ? "file" : e.type, size: e.size });
      }
    }
    const entries = [...seen.values()].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    );
    return { path: dir, entries, truncated };
  }

  async read(id: string, path: string): Promise<ContainersFileResult> {
    const file = normalize(path);
    const { buf, truncated } = await this.engine.containerArchive(id, file, FILE_CAP);
    const entry = parseTar(buf).find((e) => e.type === "file");
    if (!entry) return { path: file, content: "", truncated, binary: false };
    const end = Math.min(entry.offset + entry.size, buf.length);
    const bytes = buf.subarray(entry.offset, end);
    const binary = isBinary(bytes);
    return {
      path: file,
      content: binary ? "" : bytes.toString("utf8"),
      truncated: truncated || end < entry.offset + entry.size,
      binary,
    };
  }
}
