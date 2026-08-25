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
}

/**
 * Which peer pi extensions are installed right now. The settings UI gates each
 * provider checkbox on this: a provider is only tickable when an installed
 * source can actually serve it (see sources.ts). Names only — no paths.
 *
 * See change: add-provider-quota-plugin.
 */
export interface QuotaSourceStatusDto {
  /** `QuotaSourceId` from sources.ts. */
  id: string;
  /** npm package that supplies this source. */
  package: string;
  installed: boolean;
}

/** `GET /api/quota` response body. */
export interface ApiQuotaResponse {
  providers: ProviderQuota[];
  /**
   * Per-source availability. Optional for back-compat with a cached client
   * bundle; absent → the client falls back to "assume nothing installed" and
   * shows the install hint rather than silently enabling every checkbox.
   */
  sources?: QuotaSourceStatusDto[];
}

/** Persisted plugin config shape (`plugins.quota.*`). */
export interface QuotaPluginConfig {
  enabled?: boolean;
  providers?: Record<string, { enabled?: boolean }>;
}
