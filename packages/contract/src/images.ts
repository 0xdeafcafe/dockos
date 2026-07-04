import { z } from "zod";

// Local engine image list (docker image ls). CVE/upstream-latest are NOT available from the engine
// alone (no scanner/registry check runs), so `latest` mirrors `current`, `status` is derived from
// the dangling flag, and `cves` is zeroed — the columns stay in the shape the view renders, but the
// data is the real local repo.
export const Image = z.object({
  id: z.string(),
  repo: z.string(),
  tag: z.string(),
  current: z.string(),
  latest: z.string(),
  status: z.enum(["current", "outdated", "stale"]),
  cves: z.object({ crit: z.number(), high: z.number(), med: z.number() }),
  size: z.string(),
  age: z.string(),
});
export type Image = z.infer<typeof Image>;

export const ImagesListParams = z.object({});
export type ImagesListParams = z.infer<typeof ImagesListParams>;

export const ImagesListResult = z.object({ images: z.array(Image) });
export type ImagesListResult = z.infer<typeof ImagesListResult>;
