import { z } from "zod";

export const Network = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  internal: z.boolean(),
  containers: z.array(z.string()),
});
export type Network = z.infer<typeof Network>;

export const NetworksListParams = z.object({});
export type NetworksListParams = z.infer<typeof NetworksListParams>;

export const NetworksListResult = z.object({
  networks: z.array(Network),
});
export type NetworksListResult = z.infer<typeof NetworksListResult>;
