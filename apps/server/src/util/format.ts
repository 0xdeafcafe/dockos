// Display formatting shared by the services — output shapes match what the fleet UI renders.

const BYTE_UNITS = ["B", "k", "M", "G", "T"] as const;

// "88M", "1.1G", "512M" — one decimal from gigabytes up, none below.
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit >= 3 ? value.toFixed(1).replace(/\.0$/u, "") : String(Math.round(value));
  return `${text}${BYTE_UNITS[unit] ?? ""}`;
}

// Net counters: "0", "12k", "44M" — bare zero, no "B" suffix, matching the fleet column.
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1024) return String(Math.round(n));
  return formatBytes(n);
}

const UPTIME_UNIT: Record<string, string> = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
  week: "w",
  month: "mo",
  year: "y",
};

// Docker's human status ("Up 14 days (healthy)", "Up About an hour") → "14d", "1h".
export function compactUptime(status: string): string {
  const match =
    /^Up\s+(?:About\s+)?(?:(an?)\s+)?(\d+)?\s*(second|minute|hour|day|week|month|year)/iu.exec(
      status,
    );
  if (!match) return status.startsWith("Up") ? "0s" : "—";
  const count = match[1] ? 1 : Number(match[2] ?? 1);
  const unit = UPTIME_UNIT[(match[3] ?? "").toLowerCase()] ?? "?";
  return `${count}${unit}`;
}

// "14d 6h" style for the host readout.
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
