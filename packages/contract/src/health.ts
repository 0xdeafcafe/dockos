import { z } from "zod";

export const HealthPingInput = z.object({});
export type HealthPingInput = z.infer<typeof HealthPingInput>;

export const HealthPingOutput = z.object({
  pong: z.literal(true),
  at: z.number(),
});
export type HealthPingOutput = z.infer<typeof HealthPingOutput>;
