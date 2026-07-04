import type { z } from "zod";
import {
  AuthSessionParams,
  AuthSessionResult,
  AuthSignoutParams,
  AuthSignoutResult,
} from "./auth.ts";
import { ConfigGetParams, ConfigGetResult } from "./config.ts";
import {
  ContainerActionParams,
  ContainerActionResult,
  ContainersEnvParams,
  ContainersEnvResult,
  ContainersListParams,
  ContainersListResult,
  ContainersLogsParams,
  ContainersLogsResult,
} from "./containers.ts";
import { HealthPingInput, HealthPingOutput } from "./health.ts";
import { HostInfoParams, HostInfoResult } from "./host.ts";
import {
  MetricsContainerHistoryParams,
  MetricsContainerHistoryResult,
  MetricsHostHistoryParams,
  MetricsHostHistoryResult,
  MetricsHostParams,
  MetricsHostResult,
} from "./metrics.ts";
import { NetworksListParams, NetworksListResult } from "./networks.ts";
import {
  StackActionParams,
  StacksDownResult,
  StacksListParams,
  StacksListResult,
  StacksUpResult,
} from "./stacks.ts";

// The full RPC surface: one entry per method, params + result schemas. The server's kernel
// validates both sides against this map; the web client derives its types from it.
export const rpcMethods = {
  "health.ping": { params: HealthPingInput, result: HealthPingOutput },
  "auth.session": { params: AuthSessionParams, result: AuthSessionResult },
  "auth.signout": { params: AuthSignoutParams, result: AuthSignoutResult },
  "config.get": { params: ConfigGetParams, result: ConfigGetResult },
  "containers.list": { params: ContainersListParams, result: ContainersListResult },
  "containers.restart": { params: ContainerActionParams, result: ContainerActionResult },
  "containers.kill": { params: ContainerActionParams, result: ContainerActionResult },
  "containers.pause": { params: ContainerActionParams, result: ContainerActionResult },
  "containers.logs": { params: ContainersLogsParams, result: ContainersLogsResult },
  "containers.env": { params: ContainersEnvParams, result: ContainersEnvResult },
  "stacks.list": { params: StacksListParams, result: StacksListResult },
  "stacks.up": { params: StackActionParams, result: StacksUpResult },
  "stacks.down": { params: StackActionParams, result: StacksDownResult },
  "networks.list": { params: NetworksListParams, result: NetworksListResult },
  "host.info": { params: HostInfoParams, result: HostInfoResult },
  "metrics.host": { params: MetricsHostParams, result: MetricsHostResult },
  "metrics.hostHistory": { params: MetricsHostHistoryParams, result: MetricsHostHistoryResult },
  "metrics.containerHistory": {
    params: MetricsContainerHistoryParams,
    result: MetricsContainerHistoryResult,
  },
} as const;

export type RpcMethods = typeof rpcMethods;
export type MethodName = keyof RpcMethods;

// Parsed params (defaults applied) as the server handler receives them.
export type MethodParams<M extends MethodName> = z.output<RpcMethods[M]["params"]>;
// Params as the client sends them (fields with defaults optional).
export type MethodInput<M extends MethodName> = z.input<RpcMethods[M]["params"]>;
export type MethodResult<M extends MethodName> = z.output<RpcMethods[M]["result"]>;

export function isMethodName(value: string): value is MethodName {
  return Object.hasOwn(rpcMethods, value);
}
