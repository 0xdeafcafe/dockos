import { z } from "zod";

// Local engine volume list (docker volume ls) + which containers mount each. `size` needs
// `/system/df` (expensive, and off by default on the socket proxy), so it's reported as "—" until
// that's wired; everything else is real.
export const Volume = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  size: z.string(),
  usedBy: z.array(z.string()),
  created: z.string(),
});
export type Volume = z.infer<typeof Volume>;

export const VolumesListParams = z.object({});
export type VolumesListParams = z.infer<typeof VolumesListParams>;

export const VolumesListResult = z.object({ volumes: z.array(Volume) });
export type VolumesListResult = z.infer<typeof VolumesListResult>;
