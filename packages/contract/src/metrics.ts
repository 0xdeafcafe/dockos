import { z } from "zod";
import { ContainerId } from "./containers.ts";

// Deep history, sourced from a Prometheus server (node_exporter for the host, cadvisor for
// containers) — distinct from the short server-side ring buffers behind containers.list. The
// server queries Prometheus over DOCKOS_PROMETHEUS_URL; when Prometheus is down every method
// here answers kind "prometheus.unreachable". When the underlying series are simply absent
// (node_exporter / cadvisor not scraped) the history methods return empty arrays rather than
// erroring — the UI renders a flat/empty chart, not a fault.

// The named ranges the SYSTEM-view scopes map to. Each resolves to ~60 evenly-spaced points.
export const MetricWindow = z.enum(["15m", "1h", "6h", "24h", "7d"]);
export type MetricWindow = z.infer<typeof MetricWindow>;

// cpu/mem are aligned same-length arrays of whole percentages (0–100), matching the mock
// histories the charts already consume, so the UI needs no changes.
export const MetricSeries = z.object({
  cpu: z.array(z.number()),
  mem: z.array(z.number()),
});
export type MetricSeries = z.infer<typeof MetricSeries>;

// ── metrics.host: the current host readout for the SYSTEM view registers ─────────────────────
export const MetricsHostParams = z.object({});
export type MetricsHostParams = z.infer<typeof MetricsHostParams>;

export const MetricsHostResult = z.object({
  // whole percentages
  cpu: z.number(),
  mem: z.number(),
  // display-ready "used/total", e.g. "11.2/16G"
  memText: z.string(),
  disk: z.number(),
});
export type MetricsHostResult = z.infer<typeof MetricsHostResult>;

// ── metrics.hostHistory: node_exporter cpu% + mem% over a window (query_range) ───────────────
export const MetricsHostHistoryParams = z.object({
  window: MetricWindow.default("1h"),
  // optional resolution override, e.g. "30s" / "5m" — otherwise derived from the window
  step: z
    .string()
    .regex(/^\d+[smhd]$/u, "expected a duration like 30s, 5m, 1h")
    .optional(),
});
export type MetricsHostHistoryParams = z.infer<typeof MetricsHostHistoryParams>;

export const MetricsHostHistoryResult = MetricSeries;
export type MetricsHostHistoryResult = z.infer<typeof MetricsHostHistoryResult>;

// ── metrics.containerHistory: per-container cpu% + mem% from cadvisor over a window ───────────
// Address the unit by engine id (as handed out by containers.list) or by container name — at
// least one is required. cadvisor keys series on the container name; id is matched against its
// cgroup path (/docker/<id>…).
export const ContainerName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u, "expected a container name");

export const MetricsContainerHistoryParams = z
  .object({
    id: ContainerId.optional(),
    name: ContainerName.optional(),
    window: MetricWindow.default("1h"),
  })
  .refine((v) => v.id !== undefined || v.name !== undefined, {
    message: "provide either id or name",
  });
export type MetricsContainerHistoryParams = z.infer<typeof MetricsContainerHistoryParams>;

export const MetricsContainerHistoryResult = MetricSeries;
export type MetricsContainerHistoryResult = z.infer<typeof MetricsContainerHistoryResult>;
