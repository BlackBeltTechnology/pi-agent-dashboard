/**
 * Wire types for `/api/health.tls` (the optional TLS listener's status).
 * Browser-safe (types only): the server builds them, the Gateway "Built-in
 * HTTPS" section reads them.
 *
 * Every caller sees `{ enabled, bound }`; the detail below is disclosed only to
 * authenticated or genuinely-local callers. See change: add-tailscale-cert-tls (D8).
 */

/** An unmet precondition of the listener or of one source / name. */
export interface TlsGate {
  id: string;
  ok: boolean;
  /** Present when the gate is scoped to one certificate name. */
  name?: string;
  /** Present when the gate belongs to one source. */
  sourceId?: string;
  hint?: string;
}

/** Non-secret, source-declared status fields. */
export type TlsDetails = Record<string, string | boolean>;

export interface TlsSourceStatus {
  id: string;
  type: string;
  /** Source-level details (tailscale: `ipv4`). */
  details?: TlsDetails;
}

export interface TlsCertStatus {
  name: string;
  sourceId: string;
  sourceType: string;
  kind: "magicdns" | "domain";
  /** A certificate is loaded and served for this name. */
  held: boolean;
  /** ms epoch; absent until a certificate is held. */
  notAfter?: number;
  advertise: boolean;
  /** `"idle"` or a source-defined running stage (e.g. `"requesting"`). */
  stage: string;
  /** Truncated to 500 characters. */
  lastError?: string;
  /** ms epoch of the next scheduled attempt (backoff), when one is scheduled. */
  nextAttemptAt?: number;
  details?: TlsDetails;
}

export interface TlsStatusBasic {
  enabled: boolean;
  bound: boolean;
}

export interface TlsStatusDetail extends TlsStatusBasic {
  port: number;
  host: string;
  bindError?: string;
  gates: TlsGate[];
  sources: TlsSourceStatus[];
  certs: TlsCertStatus[];
}

export type TlsStatus = TlsStatusBasic | TlsStatusDetail;

/** True when `status` carries the disclosed detail. */
export function hasTlsDetail(status: TlsStatus): status is TlsStatusDetail {
  return Array.isArray((status as TlsStatusDetail).certs);
}
