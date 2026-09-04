/**
 * Wire contract between the quota-plugin server entry and its client entry.
 *
 * Only quota-DERIVED fields cross the wire — never a token/key.
 */

/** One normalized quota window as forwarded to the client (Date → ISO string). */
export interface QuotaWindowDto {
  label: string;
  /** 0..100. */
  usedPercent: number;
  /** ISO timestamp. */
  resetsAt: string;
  /** Window length in seconds — REQUIRED for pace. */
  windowSeconds: number;
  isCurrency?: boolean;
  usedValue?: number;
  limitValue?: number;
}

export interface ProviderQuota {
  provider: string;
  windows: QuotaWindowDto[];
  /**
   * True when this snapshot is RETAINED from an earlier successful fetch
   * because the latest refresh failed (e.g. the provider throttled us with
   * HTTP 429). The numbers are real but no longer current. Absent on a fresh
   * result. Retaining beats vanishing: a provider silently disappearing from
   * the bar reads as "you have no quota", which is a worse lie than slightly
   * stale figures. See change: publish-quota-plugin.
   */
  stale?: boolean;
}

/**
 * Why an ENABLED provider produced no quota. Ticking a provider and seeing
 * nothing is indistinguishable from a bug, so the server reports which of the
 * distinct failure paths was taken. See change: publish-quota-plugin.
 */
export type QuotaUnavailableReason =
  /** No token could be resolved for this provider (not signed in). */
  | "no-credential"
  /** This plugin has no fetcher for the provider (config names an unsupported id). */
  | "no-adapter"
  /** The endpoint was called and refused — throttled, expired token, or wrong credential shape. */
  | "peer-rejected"
  /** The peer succeeded but returned no usable window. */
  | "no-data";

/** One enabled-but-empty provider and the reason it is empty. */
export interface QuotaUnavailableDto {
  provider: string;
  reason: QuotaUnavailableReason;
}

/** `GET /api/quota` response body. */
export interface ApiQuotaResponse {
  providers: ProviderQuota[];
  /**
   * Enabled providers that yielded nothing this cycle, with the reason.
   * Omitted when empty. A provider shown from a retained snapshot is NOT
   * listed — the user can see it, so it needs no explanation.
   */
  unavailable?: QuotaUnavailableDto[];
}

/**
 * Retry policy for a transient quota-fetch failure. Off by default; every
 * numeric field is schema-bounded AND clamped on read (design D5), so a
 * hand-edited persisted config can never drive an unbounded wait or a Node
 * timer overflow. `maxAttempts` = retries AFTER the initial attempt (0 disables).
 * See change: add-quota-refresh-and-retry.
 */
export interface QuotaRetryConfig {
  enabled?: boolean;
  /** Retries after the initial attempt. Bounds: 0–5. */
  maxAttempts?: number;
  /** First backoff delay in ms; doubles each retry. Bounds: 100–10000. */
  baseDelayMs?: number;
  /** Ceiling for a single backoff delay in ms. Bounds: 100–60000. */
  maxDelayMs?: number;
}

/** Persisted plugin config shape (`plugins.quota.*`). */
export interface QuotaPluginConfig {
  enabled?: boolean;
  providers?: Record<string, { enabled?: boolean }>;
  retry?: QuotaRetryConfig;
}
