import type { Image } from "@dockos/contract";
import type { DockerEngine } from "../ports/docker.ts";
import { formatBytes } from "../util/format.ts";

// Compact age from a unix-seconds timestamp: "6h" / "14d".
function ageOf(epochSec: number): string {
  const secs = Math.max(0, Date.now() / 1000 - epochSec);
  const days = Math.floor(secs / 86400);
  if (days >= 1) return `${days}d`;
  const hrs = Math.floor(secs / 3600);
  if (hrs >= 1) return `${hrs}h`;
  return `${Math.floor(secs / 60)}m`;
}

// Local engine image list. No scanner/registry check runs, so latest mirrors current, status is
// derived from dangling, and cves are zeroed — the real repo, honestly incomplete.
export class ImageService {
  private readonly engine: DockerEngine;

  constructor(engine: DockerEngine) {
    this.engine = engine;
  }

  async list(): Promise<Image[]> {
    const images = await this.engine.listImages();
    return images
      .map((img): Image => {
        const first = (img.RepoTags ?? []).find((t) => t && t !== "<none>:<none>");
        let repo = "<none>";
        let tag = "<none>";
        if (first) {
          const at = first.lastIndexOf(":");
          repo = at > 0 ? first.slice(0, at) : first;
          tag = at > 0 ? first.slice(at + 1) : "latest";
        }
        return {
          id: img.Id.replace(/^sha256:/u, "").slice(0, 12),
          repo,
          tag,
          current: tag,
          latest: tag,
          status: first ? "current" : "stale",
          cves: { crit: 0, high: 0, med: 0 },
          size: formatBytes(img.Size),
          age: ageOf(img.Created),
        } satisfies Image;
      })
      .toSorted((a, b) => a.repo.localeCompare(b.repo));
  }
}
