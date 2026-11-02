/**
 * Process-wide dependencies of the acme source type. The cert-source registry
 * builds sources from `(entry, id, {dataDir})` only, so the vault adapter, the
 * TLS data root and the config reader are injected once here (server start) and
 * defaulted lazily for everything else. Tests replace them with
 * `configureAcmeRuntime` / `resetAcmeRuntime`.
 *
 * See change: add-acme-dns01-certs (design D5, D10).
 */
import os from "node:os";
import path from "node:path";
import { getCredentialCodec } from "../../../auth/credential-key.js";
import { readConfigState } from "../../../config-api.js";
import { createVaultStore } from "../../../vault/vault-store.js";
import { type AcmeCredentials, createAcmeCredentials } from "./credentials.js";

export interface AcmeRuntime {
  credentials: AcmeCredentials;
  /** `~/.pi/dashboard/tls` — holds `acme-account-*.key`. */
  tlsRoot: string;
  readConfigState: typeof readConfigState;
  env: NodeJS.ProcessEnv;
  log: { info(msg: string): void; warn(msg: string): void };
}

let override: Partial<AcmeRuntime> = {};
let cachedCredentials: AcmeCredentials | undefined;

export function configureAcmeRuntime(partial: Partial<AcmeRuntime>): void {
  override = { ...override, ...partial };
}

/** Test seam. */
export function resetAcmeRuntime(): void {
  override = {};
  cachedCredentials = undefined;
}

export function getAcmeRuntime(): AcmeRuntime {
  const credentials =
    override.credentials ?? (cachedCredentials ??= createAcmeCredentials(createVaultStore({ codec: getCredentialCodec("vault") })));
  return {
    credentials,
    tlsRoot: override.tlsRoot ?? path.join(os.homedir(), ".pi", "dashboard", "tls"),
    readConfigState: override.readConfigState ?? readConfigState,
    env: override.env ?? process.env,
    log: override.log ?? {
      info: (m) => console.log(`[tls/acme] ${m}`),
      warn: (m) => console.warn(`[tls/acme] ${m}`),
    },
  };
}
