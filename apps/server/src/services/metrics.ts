import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// Prometheus surface: default node/process metrics plus RPC counters, rendered at GET /metrics
// (text exposition format) when DOCKOS_METRICS is on.

export class MetricsService {
  private readonly registry = new Registry();
  private readonly rpcCount: Counter<"method" | "outcome">;
  private readonly rpcDuration: Histogram<"method">;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.rpcCount = new Counter({
      name: "dockos_rpc_requests_total",
      help: "RPC calls by method and outcome (ok or error kind)",
      labelNames: ["method", "outcome"],
      registers: [this.registry],
    });
    this.rpcDuration = new Histogram({
      name: "dockos_rpc_request_duration_seconds",
      help: "RPC call duration by method",
      labelNames: ["method"],
      buckets: [0.005, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  observeRpc(method: string, outcome: string, seconds: number): void {
    this.rpcCount.inc({ method, outcome });
    this.rpcDuration.observe({ method }, seconds);
  }

  contentType(): string {
    return this.registry.contentType;
  }

  async render(): Promise<string> {
    return await this.registry.metrics();
  }
}
