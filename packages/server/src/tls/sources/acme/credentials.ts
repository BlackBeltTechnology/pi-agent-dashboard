/**
 * Vault adapter for the ACME source's DNS-01 solver secrets (accounts of kind `tls-solver`,
 * namespace `tls:<sourceId>`) plus the secret redactor (design D5, D6).
 *
 * Values are written only through `VaultStore.upsertTlsSecrets` (one locked update, all labels or none)
 * and read only through `VaultStore.readTlsSecret`. Nothing here ever returns or logs a value except
 * `readSecret`, which hands it to the solver.
 *
 * See change: add-acme-dns01-certs (D5, D6).
 */

import { VaultError, type VaultStore } from "../../../vault/vault-store.js";
import { SOLVER_LABELS } from "./types.js";

export type SolverType = keyof typeof SOLVER_LABELS;

const REDACTED = "[redacted]";

/** Request-body field → vault label, per solver type. */
const BODY_FIELDS: Record<SolverType, Record<string, string>> = {
  cloudflare: { token: "cloudflareToken" },
  "acme-dns": { user: "acmeDnsUser", key: "acmeDnsKey" },
};

/** A client error in a credentials save (route answers 400). Never carries a value. */
export class AcmeCredentialsError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "AcmeCredentialsError";
  }
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Percent-encode like RFC 3986: `encodeURIComponent` plus `!'()*`. */
const strictEncode = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Percent-encode every byte except ASCII letters and digits, so `-`, `.`, `_`, `~` become `%2D`, `%2E`, `%5F`, `%7E`. */
const fullEncode = (s: string): string =>
  [...Buffer.from(s, "utf8")]
    .map((b) => (/[A-Za-z0-9]/.test(String.fromCharCode(b)) && b < 0x80 ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, "0")}`))
    .join("");

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");
const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

/** Every form of `secret` the redactor looks for: `exact` variants match as written, `loose` variants case-insensitively. */
function variantsOf(secret: string): { exact: Set<string>; loose: Set<string> } {
  const exact = new Set<string>([secret, JSON.stringify(secret).slice(1, -1)]);
  for (const base of [b64(secret), b64url(secret)]) {
    exact.add(base);
    exact.add(base.replace(/=+$/, ""));
  }
  const loose = new Set<string>();
  for (const single of [encodeURIComponent(secret), strictEncode(secret), fullEncode(secret)]) {
    loose.add(single);
    loose.add(single.replace(/%20/gi, "+")); // application/x-www-form-urlencoded spelling
    loose.add(encodeURIComponent(single)); // double encoded
  }
  for (const v of exact) loose.delete(v);
  return { exact, loose };
}

/**
 * Replace every secret, in every encoded form, plus auth header values and `token=` query values.
 * Pure. Empty secrets are ignored (the vault minimum is 8, but an empty string would match everywhere).
 */
export function redactSecrets(message: string, secrets: string[]): string {
  let out = message;
  const patterns: Array<{ text: string; ci: boolean }> = [];
  for (const secret of new Set(secrets.filter((s) => typeof s === "string" && s.length > 0))) {
    const { exact, loose } = variantsOf(secret);
    for (const text of exact) patterns.push({ text, ci: false });
    for (const text of loose) patterns.push({ text, ci: true });
  }
  // Longest first so a form that contains a shorter one is replaced whole.
  patterns.sort((a, b) => b.text.length - a.text.length);
  for (const { text, ci } of patterns) {
    if (text.length === 0) continue;
    out = out.replace(new RegExp(escapeRegExp(text), ci ? "gi" : "g"), REDACTED);
  }
  // `Authorization: Bearer x`, `"X-Api-Key":"x"`, `x-api-user=x` — the whole value up to the end of the line/string/field.
  out = out.replace(/((["']?)\b(?:authorization|x-api-key|x-api-user)\2\s*[:=]\s*["']?)[^\r\n"',}]+/gi, `$1${REDACTED}`);
  // `token=…`, `access_token=…` query values.
  out = out.replace(/([a-z0-9_-]*token=)[^&\s"'#]+/gi, `$1${REDACTED}`);
  return out;
}

/** Validate a credentials body into vault entries; throws `AcmeCredentialsError` (400). */
function parseBody(solverType: SolverType, body: Record<string, unknown>): Array<{ label: string; value: string }> {
  const fields = BODY_FIELDS[solverType];
  if (!fields) throw new AcmeCredentialsError("Unknown solver type");
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new AcmeCredentialsError("Body must be a JSON object");
  for (const key of Object.keys(body)) {
    if (!(key in fields)) throw new AcmeCredentialsError(`Unknown field "${key}" for solver ${solverType}`);
  }
  return Object.entries(fields).map(([field, label]) => {
    const raw = body[field];
    if (typeof raw !== "string") throw new AcmeCredentialsError(`Field "${field}" is required and must be a string`);
    const value = raw.trim();
    if (value.length === 0) throw new AcmeCredentialsError(`Field "${field}" must not be empty`);
    return { label, value };
  });
}

export interface AcmeCredentials {
  /** The solver's reader: `null` = absent. Throws `VaultError("vault_corrupt")` when the vault is unreadable. */
  readSecret(sourceId: string, label: string): Promise<string | null>;
  /** True only when EVERY label of the solver type is present. False when the vault is unavailable. Reads no value. */
  isConfigured(sourceId: string, solverType: SolverType): Promise<boolean>;
  /** `unavailable` when the vault file is corrupt or unreadable; an absent vault is `ok`. */
  vaultState(): "ok" | "unavailable";
  /** Save one solver type's body (`{token}` / `{user,key}`) in one vault update. Throws `AcmeCredentialsError` (400) on a bad body or value. */
  save(sourceId: string, solverType: SolverType, body: Record<string, unknown>): Promise<void>;
  /** Redactor over the source's CURRENT secrets (snapshot at call time) + auth headers + `token=` values. */
  redactorFor(sourceId: string, solverType: SolverType): Promise<(message: string) => string>;
  deleteNamespace(sourceId: string): Promise<void>;
  /** Source ids that hold any `tls-solver` account (for GC). */
  listNamespaces(): Promise<string[]>;
}

const BAD_VALUE_CODES = new Set(["value_too_short", "value_too_long", "invalid_field"]);

export function createAcmeCredentials(store: VaultStore): AcmeCredentials {
  const vaultState = (): "ok" | "unavailable" => {
    try {
      return store.readDocument().status.state === "corrupt" ? "unavailable" : "ok";
    } catch {
      return "unavailable";
    }
  };

  const currentSecrets = async (sourceId: string, solverType: SolverType): Promise<string[]> => {
    const out: string[] = [];
    for (const label of SOLVER_LABELS[solverType].labels) {
      try {
        const v = await store.readTlsSecret(sourceId, label);
        if (v) out.push(v);
      } catch {
        /* unavailable vault: nothing to redact beyond the pattern rules */
      }
    }
    return out;
  };

  return {
    readSecret: (sourceId, label) => store.readTlsSecret(sourceId, label),

    async isConfigured(sourceId, solverType) {
      if (vaultState() !== "ok") return false;
      try {
        const namespace = `tls:${sourceId}`;
        const present = new Set(
          (await store.listAccounts()).filter((a) => a.kind === "tls-solver" && a.namespace === namespace).map((a) => a.label),
        );
        return SOLVER_LABELS[solverType].labels.every((label) => present.has(label));
      } catch {
        return false;
      }
    },

    vaultState,

    async save(sourceId, solverType, body) {
      const entries = parseBody(solverType, body);
      try {
        await store.upsertTlsSecrets({ sourceId, provider: SOLVER_LABELS[solverType].provider, entries });
      } catch (err) {
        // Client-fixable value problems → 400; vault_corrupt and I/O errors propagate unchanged.
        if (err instanceof VaultError && BAD_VALUE_CODES.has(err.code)) throw new AcmeCredentialsError(err.message);
        throw err;
      }
    },

    async redactorFor(sourceId, solverType) {
      const secrets = await currentSecrets(sourceId, solverType);
      return (message) => redactSecrets(message, secrets);
    },

    deleteNamespace: (sourceId) => store.deleteTlsNamespace(sourceId),
    listNamespaces: () => store.listTlsNamespaces(),
  };
}
