import type {
  MetricSeries,
  MetricWindow,
  MetricsContainerHistoryParams,
  MetricsHostHistoryParams,
  MetricsHostResult,
} from "@dockos/contract";
import { PrometheusClient } from "../adapters/prometheus.ts";
import type { PromInstantSample, PromRangeSeries } from "../adapters/prometheus.ts";
import { clampPct, formatBytes } from "../util/format.ts";

// Turns Prometheus (node_exporter + cadvisor) into the deep-history shapes the SYSTEM view and
// container detail render — cpu/mem as whole-percentage arrays, same as the mock histories, so
// the UI is unchanged. Distinct from services/metrics.ts, which EXPORTS prom-client metrics at
// /metrics; this one QUERIES a Prometheus server.
//
// When a series is simply absent (node_exporter / cadvisor not scraped) the history methods
// return empty arrays and the host readout returns zeros — a missing exporter is a flat chart,
// not a fault. Prometheus itself being unreachable surfaces as kind "prometheus.unreachable"
// (raised by the adapter).

// Each named window resolves to a range + a step giving ~60 evenly-spaced points.
const WINDOWS: Record<MetricWindow, { rangeSeconds: number; stepSeconds: number }> = {
  "15m": { rangeSeconds: 900, stepSeconds: 15 },
  "1h": { rangeSeconds: 3600, stepSeconds: 60 },
  "6h": { rangeSeconds: 21_600, stepSeconds: 360 },
  "24h": { rangeSeconds: 86_400, stepSeconds: 1440 },
  "7d": { rangeSeconds: 604_800, stepSeconds: 10_080 },
};

const STEP_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

function parseStep(step: string | undefined): number | null {
  if (step === undefined) return null;
  const match = /^(\d+)([smhd])$/u.exec(step);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = STEP_UNIT_SECONDS[match[2] ?? "s"] ?? 1;
  return n > 0 ? n * unit : null;
}

// A whole percentage in [0, 100]; non-finite samples (NaN / ±Inf from a missing divisor) → 0.
function sanitizePct(value: number): number {
  return Number.isFinite(value) ? Math.round(clampPct(value)) : 0;
}

function firstValue(samples: PromInstantSample[]): number | null {
  const value = samples[0]?.sample.value;
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function firstSeries(series: PromRangeSeries[]): number[] {
  return (series[0]?.samples ?? []).map((s) => sanitizePct(s.value));
}

export class MetricsQueryService {
  private readonly prom: PrometheusClient;

  constructor(prom: PrometheusClient) {
    this.prom = prom;
  }

  // Convenience factory so the composition root only depends on this service, not the adapter.
  static fromUrl(baseUrl: string): MetricsQueryService {
    return new MetricsQueryService(new PrometheusClient(baseUrl));
  }

  // Current host cpu% / mem% / memText / disk% for the SYSTEM registers.
  async host(): Promise<MetricsHostResult> {
    const [cpu, memPct, memUsed, memTotal, disk] = await Promise.all([
      this.prom.query('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'),
      this.prom.query(
        "avg(100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))",
      ),
      this.prom.query("avg(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)"),
      this.prom.query("avg(node_memory_MemTotal_bytes)"),
      this.prom.query(
        '100 * (1 - avg(node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"}) / ' +
          'avg(node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"}))',
      ),
    ]);
    const total = firstValue(memTotal);
    const used = firstValue(memUsed);
    return {
      cpu: sanitizePct(firstValue(cpu) ?? 0),
      mem: sanitizePct(firstValue(memPct) ?? 0),
      memText: total && total > 0 ? `${formatBytes(used ?? 0)}/${formatBytes(total)}` : "—",
      disk: sanitizePct(firstValue(disk) ?? 0),
    };
  }

  // node_exporter cpu% + mem% over the requested window (query_range).
  async hostHistory(params: MetricsHostHistoryParams): Promise<MetricSeries> {
    const { start, end, step } = this.range(params.window, params.step);
    const rate = `${Math.max(step, 60)}s`;
    const [cpu, mem] = await Promise.all([
      this.prom.queryRange(
        `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[${rate}])) * 100)`,
        start,
        end,
        step,
      ),
      this.prom.queryRange(
        "avg(100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))",
        start,
        end,
        step,
      ),
    ]);
    return { cpu: firstSeries(cpu), mem: firstSeries(mem) };
  }

  // Per-container cpu% + mem% from cadvisor over the requested window (query_range). cpu% is
  // fraction-of-a-core summed × 100 (clamped to 100); mem% is usage over host memory.
  async containerHistory(params: MetricsContainerHistoryParams): Promise<MetricSeries> {
    const { start, end, step } = this.range(params.window);
    const rate = `${Math.max(step, 60)}s`;
    const selector =
      params.name === undefined ? `id=~"/docker/${params.id ?? ""}.*"` : `name="${params.name}"`;
    const [cpu, mem] = await Promise.all([
      this.prom.queryRange(
        `sum(rate(container_cpu_usage_seconds_total{${selector}}[${rate}])) * 100`,
        start,
        end,
        step,
      ),
      this.prom.queryRange(
        `sum(container_memory_usage_bytes{${selector}}) / scalar(max(machine_memory_bytes)) * 100`,
        start,
        end,
        step,
      ),
    ]);
    return { cpu: firstSeries(cpu), mem: firstSeries(mem) };
  }

  private range(
    window: MetricWindow,
    stepOverride?: string,
  ): { start: number; end: number; step: number } {
    const preset = WINDOWS[window];
    const step = parseStep(stepOverride) ?? preset.stepSeconds;
    const end = Math.floor(Date.now() / 1000);
    return { start: end - preset.rangeSeconds, end, step };
  }
}
