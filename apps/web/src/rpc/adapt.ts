import type {
  ContainersEnvResult,
  ContainersListResult,
  ContainersLogsResult,
  HostInfoResult,
  NetworksListResult,
  StacksListResult,
} from "@dockos/contract";
import type { Container, EnvVar, LogLine, Profile } from "../data/mock.ts";

// Shape adaptation between contract results and what the phase-0 views consume. The backend was
// built to mirror mock.ts, so these are near-identity — they exist to (a) bridge the naming gap
// (the contract calls a compose group a `Stack`, the views call it a `Profile`) and (b) give the
// views a single place to absorb any future drift without touching call sites.
//
// KNOWN GAPS (contract → mock):
//   • Stack vs Profile — same fields, but the contract's optional `note` is `string | undefined`
//     (zod `.optional()`) while the view's `Profile.note` is `string` under
//     exactOptionalPropertyTypes. `adaptStacks` rebuilds each row, attaching `note` only when set.
//   • networks — mock.ts has NO networks fixture. `adaptNetworks` returns the contract `Network[]`
//     as-is; any networks view should consume the contract type directly (there is nothing to
//     adapt to). The mock client synthesizes a small set so the call still resolves.
//   • host — mock.ts's `HOST` is an untyped literal; the contract `HostInfo` is its typed superset.
//     `adaptHost` is an identity returning the contract type.
//   • container detail / image audit — mock.ts's `detailFor`, `ImageAudit`, `HOST_HISTORY` have NO
//     contract method yet (no `containers.inspect` / `images.list` / host history in methods.ts).
//     Those views must keep their mock source until the contract grows the methods.

export function adaptFleet(result: ContainersListResult): Container[] {
  return result.containers;
}

export function adaptStacks(result: StacksListResult): Profile[] {
  return result.stacks.map((stack) => {
    const profile: Profile = {
      name: stack.name,
      state: stack.state,
      services: stack.services,
      cpu: stack.cpu,
      mem: stack.mem,
    };
    if (stack.note !== undefined) profile.note = stack.note;
    return profile;
  });
}

export function adaptLogs(result: ContainersLogsResult): LogLine[] {
  return result.lines;
}

export function adaptEnv(result: ContainersEnvResult): EnvVar[] {
  return result.env;
}

export function adaptNetworks(result: NetworksListResult): NetworksListResult["networks"] {
  return result.networks;
}

export function adaptHost(result: HostInfoResult): HostInfoResult {
  return result;
}
