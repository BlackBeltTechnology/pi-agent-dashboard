/**
 * Shared constants for credential-at-rest encryption: keychain identity, file
 * ids, the envelope magic line, the lock/key reason codes and the fixed
 * reason → remedy table (used by the vault status, the page and refusal
 * messages). Import-free leaf: no node built-ins, safe for client bundles.
 *
 * Remedy texts are fixed, non-secret strings: never interpolate key material.
 * See change: encrypt-credentials-at-rest (D3, D4, D5, D6, D12).
 */

/** Keychain service. Distinct from `pi-dashboard`, which users own for `keychain:` refs (D4, D10). */
export const CREDENTIAL_KEYCHAIN_SERVICE = "pi-dashboard-credential-key";

/** Keychain account (item username). */
export const CREDENTIAL_KEYCHAIN_ACCOUNT = "data-key-v1";

/** Env var naming the explicit key file. When set it is the ONLY key source (D6). */
export const DATA_KEY_FILE_ENV = "PI_DASHBOARD_DATA_KEY_FILE";

/** Identity of an encrypted credential file; bound into the AEAD additional data. */
export const CREDENTIAL_FILE_IDS = ["plugin-credentials", "vault"] as const;
export type CredentialFileId = (typeof CREDENTIAL_FILE_IDS)[number];

/** On-disk basename of each credential file (the agent credential guard protects these). */
export const CREDENTIAL_FILE_BASENAMES: Readonly<Record<CredentialFileId, string>> = {
  "plugin-credentials": "plugin-credentials.json",
  vault: "vault.json",
};

/** Any file whose first line starts with this is an envelope and is never "corrupt" (D2). */
export const ENVELOPE_MAGIC_PREFIX = "pi-dashboard-encrypted:";

/** First line of a v1 envelope file. */
export const ENVELOPE_MAGIC_V1 = "pi-dashboard-encrypted:v1";

/** Reasons the data key is not available (the key state's reason). */
export const CREDENTIAL_KEY_FAILURE_REASONS = [
  "keychain_unavailable",
  "keychain_timeout",
  "key_missing",
  "key_file_missing",
  "key_file_invalid",
  "key_file_insecure",
  "key_uninitialized",
] as const;
export type CredentialKeyFailureReason = (typeof CREDENTIAL_KEY_FAILURE_REASONS)[number];

/** Reasons a file is locked: a key failure, or a problem with the envelope itself. */
export const CREDENTIAL_LOCK_REASONS = [
  ...CREDENTIAL_KEY_FAILURE_REASONS,
  "key_mismatch",
  "unsupported_format",
  "envelope_damaged",
] as const;
export type CredentialLockReason = (typeof CREDENTIAL_LOCK_REASONS)[number];

/** Narrowing guard. An unknown future reason must still render as locked, never as ok. */
export function isCredentialLockReason(value: unknown): value is CredentialLockReason {
  return typeof value === "string" && (CREDENTIAL_LOCK_REASONS as readonly string[]).includes(value);
}

const KEY_FILE_HINT =
  `Set ${DATA_KEY_FILE_ENV} to an owner-only file holding \`openssl rand -base64 32\` and restart the server.`;
const RESET_HINT =
  "Restore the key, or run `pi-dashboard credentials reset --vault` " +
  "(`--plugin-credentials` for the plugin credential file) with the server stopped and enter the credentials again.";

/** Reason → remedy (decision G3). Every reason has a non-empty, non-secret remedy. */
export const CREDENTIAL_REASON_REMEDY: Readonly<Record<CredentialLockReason, string>> = {
  keychain_unavailable: `The OS keychain cannot be used. ${KEY_FILE_HINT}`,
  keychain_timeout: `The OS keychain did not answer in time. ${KEY_FILE_HINT}`,
  key_missing: `The data key is missing. ${RESET_HINT}`,
  key_file_missing: `The key file named by ${DATA_KEY_FILE_ENV} does not exist. ${KEY_FILE_HINT}`,
  key_file_invalid: `The key file named by ${DATA_KEY_FILE_ENV} is not a readable base64 32-byte key. ${KEY_FILE_HINT}`,
  key_file_insecure: `The key file named by ${DATA_KEY_FILE_ENV} is readable by other users. Run chmod 600 on it, then restart the server.`,
  key_uninitialized: "The data key has not been loaded yet. Restart the server.",
  key_mismatch: `The file was encrypted with a different key. ${RESET_HINT}`,
  unsupported_format: "The file uses a newer encryption format. Upgrade the dashboard.",
  envelope_damaged: "The encrypted file is damaged. Restore it from a backup, or reset it with `pi-dashboard credentials reset`.",
};

/** The remedy for a lock reason. Unknown reasons get the generic fallback. */
export function credentialRemedy(reason: string): string {
  return isCredentialLockReason(reason)
    ? CREDENTIAL_REASON_REMEDY[reason]
    : "The credential file is locked. Check the dashboard server log.";
}
