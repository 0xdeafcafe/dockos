import { z } from "zod";
import { StackName } from "./containers.ts";

// A "stack" is a compose profile when the server has the compose file (DOCKING_COMPOSE_FILE),
// otherwise the compose project a unit belongs to. Services with no profile group under
// "(default)". Aggregates are display-ready strings, matching the stacks screen.

export const StackState = z.enum(["up", "partial", "down"]);
export type StackState = z.infer<typeof StackState>;

export const Stack = z.object({
  name: z.string(),
  state: StackState,
  services: z.string(),
  cpu: z.string(),
  mem: z.string(),
  note: z.string().optional(),
});
export type Stack = z.infer<typeof Stack>;

export const StacksListParams = z.object({});
export type StacksListParams = z.infer<typeof StacksListParams>;

export const StacksListResult = z.object({
  stacks: z.array(Stack),
});
export type StacksListResult = z.infer<typeof StacksListResult>;

// Gated: names must match a stack the server itself listed — free-form input fails validation
// here and unknown-but-well-formed names fail with kind "unit.not_found" on the server.
export const StackActionParams = z.object({
  name: StackName,
});
export type StackActionParams = z.infer<typeof StackActionParams>;

// up starts / down stops the stack's existing containers via the engine. Declared services that
// have no container yet (never created by compose) are reported in `skipped` — the engine API
// cannot create them.
export const StacksUpResult = z.object({
  name: z.string(),
  started: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type StacksUpResult = z.infer<typeof StacksUpResult>;

export const StacksDownResult = z.object({
  name: z.string(),
  stopped: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type StacksDownResult = z.infer<typeof StacksDownResult>;
