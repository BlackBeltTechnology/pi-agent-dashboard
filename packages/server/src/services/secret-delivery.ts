/**
 * Secret delivery channels (D8):
 * - OCI: one 0600 file per secret under `services-run/<id>/secrets/<name>`
 *   (dir 0700), mounted `:ro` at `/run/secrets/<name>`. Never `-e`, never
 *   `--env-file` (both persist in `inspect` `Config.Env`).
 * - native / attached start commands: the definition's declared env names,
 *   in the spawned child's env only.
 * - `service exec`: `SVC_<ID>_<NAME>` in the child's env only.
 * See change: add-service-registry-core.
 */
import fs from "node:fs";
import path from "node:path";
import {
  execSecretEnvName,
  type ServiceDefinition,
} from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { ensurePrivateDir } from "./paths.js";

export const CONTAINER_SECRETS_DIR = "/run/secrets";

/** Write the mounted secret files; returns `-v host:/run/secrets/<n>:ro` pairs. */
export function writeSecretMounts(secretsDir: string, values: Record<string, string>): Array<{ host: string; container: string }> {
  ensurePrivateDir(secretsDir);
  const mounts: Array<{ host: string; container: string }> = [];
  for (const [name, value] of Object.entries(values)) {
    const host = path.join(secretsDir, name);
    // In place, NOT tmp+rename: a single-file bind mount pins the inode, so a
    // renamed replacement would be invisible to a reused container.
    fs.writeFileSync(host, value, { mode: 0o600 });
    fs.chmodSync(host, 0o600);
    mounts.push({ host, container: `${CONTAINER_SECRETS_DIR}/${name}` });
  }
  return mounts;
}

/** Non-secret env pointing at the mount path for secrets that declare `env` (OCI). */
export function secretPathEnv(def: ServiceDefinition): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, spec] of Object.entries(def.secrets ?? {})) {
    if (spec.env) env[spec.env] = `${CONTAINER_SECRETS_DIR}/${name}`;
  }
  return env;
}

/** Child env for a native / attached start command: declared env names → values. */
export function startCommandSecretEnv(def: ServiceDefinition, values: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, spec] of Object.entries(def.secrets ?? {})) {
    if (spec.env && values[name] !== undefined) env[spec.env] = values[name];
  }
  return env;
}

/** Child env for `service exec`: `SVC_<ID>_<NAME>` per secret. */
export function execSecretEnv(id: string, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([n, v]) => [execSecretEnvName(id, n), v]));
}

export function removeSecretMounts(secretsDir: string): void {
  fs.rmSync(secretsDir, { recursive: true, force: true });
}
