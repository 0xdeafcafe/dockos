import type { Volume } from "@dockos/contract";
import type { DockerEngine } from "../ports/docker.ts";

// Compact age from an RFC3339 timestamp: "6h" / "14d" (or "—" when the engine omits CreatedAt).
function ageOf(iso: string | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, (Date.now() - t) / 1000);
  const days = Math.floor(secs / 86400);
  if (days >= 1) return `${days}d`;
  const hrs = Math.floor(secs / 3600);
  if (hrs >= 1) return `${hrs}h`;
  return `${Math.floor(secs / 60)}m`;
}

// Local engine volume list, with usedBy cross-referenced from container mounts. Size needs
// /system/df (off by default on the socket proxy), so it's "—" for now.
export class VolumeService {
  private readonly engine: DockerEngine;

  constructor(engine: DockerEngine) {
    this.engine = engine;
  }

  async list(): Promise<Volume[]> {
    const [volumes, containers] = await Promise.all([
      this.engine.listVolumes(),
      this.engine.listContainers(true),
    ]);
    // volume name → the containers mounting it (by container name, leading slash stripped)
    const usedBy = new Map<string, string[]>();
    for (const c of containers) {
      const cname = (c.Names[0] ?? "").replace(/^\//u, "");
      for (const m of c.Mounts ?? []) {
        if (m.Type === "volume" && m.Name) {
          const arr = usedBy.get(m.Name) ?? [];
          if (!arr.includes(cname)) arr.push(cname);
          usedBy.set(m.Name, arr);
        }
      }
    }
    return volumes
      .map(
        (v): Volume => ({
          name: v.Name,
          driver: v.Driver,
          mountpoint: v.Mountpoint,
          size: "—",
          usedBy: (usedBy.get(v.Name) ?? []).toSorted(),
          created: ageOf(v.CreatedAt),
        }),
      )
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }
}
