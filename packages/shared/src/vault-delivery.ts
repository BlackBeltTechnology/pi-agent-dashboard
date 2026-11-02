/**
 * Credential-vault delivery constants shared by the hub and the bridge.
 *
 * The bridge and the hub clamp the offline grace independently so a misbehaving
 * hub cannot stretch retention past a week or shrink it below an hour.
 *
 * See change: add-credential-vault (D2).
 */

/** Advertised in `dashboard_identity.features`; a bridge holding values withdraws them when it is absent. */
export const VAULT_DELIVERY_FEATURE = "vault-delivery";

/**
 * Names only (comma-separated), never values or hashes. Set in the environment
 * of a pi process that received vault values so a nested pi (subagent, flow
 * agent) masks them without claiming ownership.
 */
export const VAULT_DELIVERED_MARKER_ENV = "PI_DASHBOARD_VAULT_DELIVERED";

export const VAULT_GRACE_DEFAULT_HOURS = 24;
export const VAULT_GRACE_MIN_HOURS = 1;
export const VAULT_GRACE_MAX_HOURS = 168;

/** Clamp an offline grace (hours) into [1, 168]; non-numbers take the default. */
export function clampVaultGraceHours(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : VAULT_GRACE_DEFAULT_HOURS;
  return Math.min(VAULT_GRACE_MAX_HOURS, Math.max(VAULT_GRACE_MIN_HOURS, n));
}

/** Why a session did or did not receive values. Never carries a value. */
export type VaultDeliveryOutcome =
  | "delivered"
  | "disabled"
  | "untrusted"
  | "transport-insecure"
  | "no-project"
  | "vault-unavailable";

/**
 * Which proof a refused remote session is missing (never a value). Carried on the
 * session vault state next to `VaultDeliveryOutcome`, which is unchanged.
 * See change: prove-vault-bridge-tls (D5, D8).
 */
export type VaultTrustDetail =
  | "unattributed"
  | "local-unproven"
  | "device-inactive"
  | "plain-transport"
  | "bearer-exposed"
  | "history-unknown"
  | "ticket-plain"
  | "bridge-outdated";

// ── Env name rule ───────────────────────────────────────────────────────────
//
// One definition for the hub (at binding creation and snapshot building) and
// the bridge (before it touches `process.env`). `PYTHON`/`PERL`/`RUBY`
// prefixes deliberately over-block, which fails safe. The spawn-env
// contributor's own lists are untouched.

const NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

const RESERVED_EXACT = new Set([
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "SHELL", "COMSPEC", "SYSTEMROOT",
  "PS4", "SSH_AUTH_SOCK", "SSH_ASKPASS", "LOCPATH", "GCONV_PATH",
  "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "DOTNET_STARTUP_HOOKS", "LESSOPEN", "LESSCLOSE", "OPENSSL_CONF",
  "ENV", "BASH_ENV", "BASHOPTS", "SHELLOPTS", "PROMPT_COMMAND", "IFS", "CDPATH", "ZDOTDIR",
  "TMPDIR", "EDITOR", "VISUAL", "PAGER",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE",
]);

const RESERVED_PREFIXES = [
  "LD_", "DYLD_", "NODE_", "NPM_CONFIG_", "PI_", "PYTHON", "PERL", "RUBY",
  "GIT_", "BASH_FUNC_", "ELECTRON_", "CONTEXT_MODE_", "XDG_",
];

/** Reserved regardless of letter case (Windows env names are case-insensitive). */
export function isReservedEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return RESERVED_EXACT.has(upper) || RESERVED_PREFIXES.some((p) => upper.startsWith(p));
}

/** The creation rule and the delivery rule are the same predicate. */
export function isDeliverableEnvName(name: unknown): name is string {
  return typeof name === "string" && NAME_PATTERN.test(name) && !isReservedEnvName(name);
}

