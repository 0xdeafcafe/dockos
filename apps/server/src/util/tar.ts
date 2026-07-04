// Minimal ustar/GNU tar reader — 512-byte header blocks. Enough to list a directory archive and
// read a single file's bytes from a Docker `/archive` response. Content isn't copied; each entry
// carries its byte `offset` into the source buffer so the caller can slice it.

export interface TarEntry {
  name: string;
  type: "dir" | "file" | "link" | "other";
  size: number;
  offset: number;
}

function cstr(b: Buffer, off: number, len: number): string {
  const slice = b.subarray(off, off + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
}

export function parseTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let pos = 0;
  let longName: string | null = null;
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break; // zero block → end of archive
    const name = cstr(header, 0, 100);
    const prefix = cstr(header, 345, 155);
    const sizeOct = cstr(header, 124, 12).trim();
    const size = sizeOct ? Number.parseInt(sizeOct, 8) || 0 : 0;
    const typeflag = String.fromCharCode(header[156] ?? 0);
    pos += 512;
    if (typeflag === "L") {
      // GNU long-name entry: the next `size` bytes hold the real name for the FOLLOWING header
      longName = buf
        .subarray(pos, pos + size)
        .toString("utf8")
        .replace(/\0+$/u, "");
      pos += Math.ceil(size / 512) * 512;
      continue;
    }
    const full = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    const type: TarEntry["type"] =
      typeflag === "5"
        ? "dir"
        : typeflag === "2" || typeflag === "1"
          ? "link"
          : typeflag === "0" || typeflag === "\0" || typeflag === "7"
            ? "file"
            : "other";
    entries.push({ name: full, type, size, offset: pos });
    pos += Math.ceil(size / 512) * 512;
  }
  return entries;
}
