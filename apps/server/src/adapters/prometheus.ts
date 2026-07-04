import { HandledError } from "@dockos/contract";

// A thin client for a Prometheus server's HTTP API (env DOCKOS_PROMETHEUS_URL, e.g.
// http://prometheus:9090). Instant queries (/api/v1/query) and range queries
// (/api/v1/query_range) only — no client dependency, plain fetch like adapters/oidc.ts.
//
// Failure model, mirroring docker-http.ts:
//   • network error / timeout / DNS   → HandledError kind "prometheus.unreachable"
//   • non-2xx or status:"error" body  → HandledError kind "prometheus.error"
// An empty-but-successful result (no matching series) is NOT an error — it comes back as an
// empty sample/series list, and callers decide what that means.

const QUERY_TIMEOUT_MS = 10_000;

// One point of a series: a unix timestamp (seconds, fractional) and its numeric value.
export interface PromSample {
  time: number;
  value: number;
}

// An instant-vector element: the series' labels plus its single current sample.
export interface PromInstantSample {
  metric: Record<string, string>;
  sample: PromSample;
}

// A range-vector element: the series' labels plus its samples over the window.
export interface PromRangeSeries {
  metric: Record<string, string>;
  samples: PromSample[];
}

interface PromEnvelope {
  status: string;
  errorType?: string;
  error?: string;
  data?: {
    resultType: string;
    result: unknown;
  };
}

// Prometheus encodes sample values as [ <ts:number>, "<value:string>" ]; the string may be
// "NaN" / "+Inf" / "-Inf". parseFloat turns those into the corresponding JS numbers, which the
// callers sanitize.
function parsePair(pair: unknown): PromSample | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const time = Number(pair[0]);
  const value = Number(String(pair[1]));
  if (!Number.isFinite(time)) return null;
  return { time, value };
}

export class PrometheusClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
  }

  // Instant query at the server's current time. Returns one element per matching series
  // (empty array when nothing matches). A scalar result is normalized to a single element.
  async query(promql: string): Promise<PromInstantSample[]> {
    const params = new URLSearchParams({ query: promql });
    const data = await this.fetchApi("/api/v1/query", params);
    if (!data) return [];
    if (data.resultType === "scalar") {
      const sample = parsePair(data.result);
      return sample ? [{ metric: {}, sample }] : [];
    }
    if (!Array.isArray(data.result)) return [];
    const out: PromInstantSample[] = [];
    for (const row of data.result) {
      const entry = row as { metric?: Record<string, string>; value?: unknown };
      const sample = parsePair(entry.value);
      if (sample) out.push({ metric: entry.metric ?? {}, sample });
    }
    return out;
  }

  // Range query over [start, end] at the given step (seconds). Returns one series per matching
  // element (empty array when nothing matches).
  async queryRange(
    promql: string,
    start: number,
    end: number,
    stepSeconds: number,
  ): Promise<PromRangeSeries[]> {
    const params = new URLSearchParams({
      query: promql,
      start: String(start),
      end: String(end),
      step: String(stepSeconds),
    });
    const data = await this.fetchApi("/api/v1/query_range", params);
    if (!data || !Array.isArray(data.result)) return [];
    const out: PromRangeSeries[] = [];
    for (const row of data.result) {
      const entry = row as { metric?: Record<string, string>; values?: unknown[] };
      const samples: PromSample[] = [];
      for (const pair of entry.values ?? []) {
        const sample = parsePair(pair);
        if (sample) samples.push(sample);
      }
      out.push({ metric: entry.metric ?? {}, samples });
    }
    return out;
  }

  private async fetchApi(
    path: string,
    params: URLSearchParams,
  ): Promise<PromEnvelope["data"] | null> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new HandledError(
        "prometheus.unreachable",
        `cannot reach prometheus at ${this.baseUrl}`,
        {
          hint: "check DOCKOS_PROMETHEUS_URL and that the prometheus server is running",
          meta: { url: this.baseUrl },
          cause,
        },
      );
    }
    const text = await res.text().catch(() => "");
    let body: PromEnvelope;
    try {
      body = JSON.parse(text) as PromEnvelope;
    } catch {
      // A non-JSON body on a bad status is a server/proxy error, not an empty result.
      throw new HandledError("prometheus.error", `prometheus returned ${res.status}`, {
        meta: { url: this.baseUrl, status: res.status },
      });
    }
    if (!res.ok || body.status === "error") {
      throw new HandledError(
        "prometheus.error",
        body.error ?? `prometheus returned ${res.status}`,
        {
          meta: { url: this.baseUrl, status: res.status, errorType: body.errorType },
        },
      );
    }
    return body.data ?? null;
  }
}
