/**
 * Certificate-source contract for the optional TLS listener.
 *
 * A `CertSource` produces PEM pairs for one or more names; the `CertManager`
 * owns everything else (scheduling, backoff, files, serving). New source types
 * register through `registerCertSourceType` without touching the manager.
 *
 * See change: add-tailscale-cert-tls (design D3).
 */

/** Unmet/met precondition of a source (or of one name of it). `name` scopes the gate to that name. */
export interface Gate {
  id: string;
  ok: boolean;
  name?: string;
  hint?: string;
}

/** Non-secret, source-declared status fields. */
export type SourceDetails = Record<string, string | boolean>;

/** What `obtain()` returns. Only the manager writes files. */
export interface ObtainedCert {
  certPem: string;
  keyPem: string;
  /** false → served, but never enumerated/paired. */
  advertise: boolean;
  kind: "magicdns" | "domain";
  details?: SourceDetails;
}

/** A failure that carries a source-imposed minimum retry delay. */
export class RetryAfterError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RetryAfterError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface SourceReadiness {
  gates: Gate[];
  /** Source-level, non-secret (tailscale: `ipv4`). */
  details?: SourceDetails;
}

export interface CertSource {
  /** Stable; tailscale → "tailscale". */
  readonly id: string;
  /** Registered source type. */
  readonly type: string;
  /** `null` = cannot tell right now (daemon down) → the manager must not prune. */
  names(): Promise<string[] | null>;
  /** Hash of the settings affecting THIS name's certificate (never the whole list). */
  configFingerprint(name: string): string;
  obtain(name: string, onStage: (stage: string) => void): Promise<ObtainedCert>;
  /** Cached by the source; `force` re-checks now. Status reads never call out. */
  readiness(opts?: { force?: boolean }): Promise<SourceReadiness>;
  /** The manager abandons an attempt after this (default 10 min). */
  readonly attemptTimeoutMs?: number;
  /** Source-owned GC after each reconcile. */
  onReconciled?(): Promise<void>;
  /** Source-owned cleanup outside `<sourceId>/`. */
  onRemoved?(): Promise<void>;
}

export interface CertSourceDeps {
  /** Per-source scratch/data dir under the dashboard data dir. */
  dataDir: string;
}

export interface CertSourceType {
  type: string;
  /** Default `id` when an entry omits it (tailscale → "tailscale"). */
  defaultId?: string;
  /** Per-type config check → 400 message, or `null` when valid. */
  validate(entry: Record<string, unknown>): string | null;
  create(entry: Record<string, unknown>, id: string, deps: CertSourceDeps): CertSource;
}
