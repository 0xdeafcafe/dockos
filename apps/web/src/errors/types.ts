// Mirrors the server contract's SerializedError, plus a client-only hint line.
export interface ClientError {
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
  hint?: string;
}
