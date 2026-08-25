/**
 * Wire contract between the quota-plugin server entry and its client entry.
 *
 * Only quota-DERIVED fields cross the wire — never a token/key. `provider` is
 * never `"anthropic"` (excluded upstream of serialization).
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
}

/** `GET /api/quota` response body. */
export interface ApiQuotaResponse {
  providers: ProviderQuota[];
}

/** Persisted plugin config shape (`plugins.quota.*`). */
export interface QuotaPluginConfig {
  enabled?: boolean;
  acknowledgedToS?: boolean;
  providers?: Record<string, { enabled?: boolean }>;
}
