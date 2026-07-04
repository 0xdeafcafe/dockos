import { z } from "zod";

// The status-bar host readout. cpu/disk are whole percentages; memText/uptime are display-ready.
// uptime approximates from the longest-running unit (the engine API exposes no host boot time).
export const HostInfo = z.object({
  engine: z.string(),
  uptime: z.string(),
  running: z.number(),
  total: z.number(),
  images: z.number(),
  volumes: z.number(),
  networks: z.number(),
  cpu: z.number(),
  memText: z.string(),
  disk: z.number(),
});
export type HostInfo = z.infer<typeof HostInfo>;

export const HostInfoParams = z.object({});
export type HostInfoParams = z.infer<typeof HostInfoParams>;

export const HostInfoResult = HostInfo;
export type HostInfoResult = z.infer<typeof HostInfoResult>;
