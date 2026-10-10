/**
 * Secret reference resolution: `store:<id>/<name>`, `env:<NAME>`, and the
 * READ-ONLY `keychain:<service>/<account>` (macOS `security
 * find-generic-password … -w`, Linux `secret-tool lookup`, 10 s timeout).
 *
 * A ref that cannot be resolved is `secret-unavailable` — there is NEVER a
 * fallback to another backend (a keychain ref never consults the store). The
 * dashboard never writes a keychain entry: `security add-generic-password -w
 * <value>` puts the value in argv. Hints never carry a value.
 * See change: add-service-registry-core (D8).
 */
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { CommandRunner } from "./command-runner.js";
import { SecretsCorruptError, type SecretsStore } from "./secrets-store.js";

export const KEYCHAIN_TIMEOUT_MS = 10_000;

export type SecretResolution =
  | { ok: true; value: string }
  | { ok: false; reason: "secret-unavailable"; hint: string };

export interface SecretResolverDeps {
  store: SecretsStore;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  run: CommandRunner;
  /** Tool-registry lookup → absolute path, or null when not installed. */
  resolveBinary: (name: string) => string | null;
}

const unavailable = (hint: string): SecretResolution => ({ ok: false, reason: "secret-unavailable", hint });

/** The default ref for a declared secret without one. */
export function defaultSecretRef(id: string, name: string): string {
  return `store:${id}/${name}`;
}

/** Build the read-only keychain argv for `platform`, or null when unsupported. */
export function keychainArgv(
  platform: NodeJS.Platform,
  service: string,
  account: string,
): { tool: string; args: string[] } | null {
  if (platform === "darwin") return { tool: "security", args: ["find-generic-password", "-s", service, "-a", account, "-w"] };
  if (platform === "linux") return { tool: "secret-tool", args: ["lookup", "service", service, "account", account] };
  return null;
}

export async function resolveSecretRef(ref: string, deps: SecretResolverDeps): Promise<SecretResolution> {
  const colon = ref.indexOf(":");
  const scheme = ref.slice(0, colon);
  const rest = ref.slice(colon + 1);
  if (scheme === "store") {
    const slash = rest.indexOf("/");
    try {
      const v = deps.store.get(rest.slice(0, slash), rest.slice(slash + 1));
      return v === undefined ? unavailable(`secret ${rest} is not set (pi-dashboard service secret set …)`) : { ok: true, value: v };
    } catch (err) {
      if (err instanceof SecretsCorruptError) {
        return unavailable(`the secret store is corrupt; backup: ${err.backupPath ?? "not written"}`);
      }
      return unavailable("the secret store could not be read");
    }
  }
  if (scheme === "env") {
    const v = deps.env[rest];
    return typeof v === "string" && v.length > 0 ? { ok: true, value: v } : unavailable(`env var ${rest} is not set`);
  }
  if (scheme === "keychain") {
    const slash = rest.indexOf("/");
    const argv = keychainArgv(deps.platform, rest.slice(0, slash), rest.slice(slash + 1));
    if (!argv) return unavailable(`keychain refs are not supported on ${deps.platform}`);
    const bin = deps.resolveBinary(argv.tool);
    if (!bin) return unavailable(`${argv.tool} is not installed`);
    const r = await deps.run(bin, argv.args, { timeoutMs: KEYCHAIN_TIMEOUT_MS });
    if (r.timedOut) return unavailable(`${argv.tool} did not answer within ${KEYCHAIN_TIMEOUT_MS / 1000} s (locked keychain or pending prompt?)`);
    if (r.code !== 0) return unavailable(`${argv.tool} could not read the item (missing, locked, or no session bus)`);
    const value = r.stdout.replace(/\r?\n$/, "");
    return value.length > 0 ? { ok: true, value } : unavailable(`${argv.tool} returned an empty value`);
  }
  return unavailable(`unknown secret ref scheme ${JSON.stringify(scheme)}`);
}

export type ServiceSecretsResolution =
  | { ok: true; values: Record<string, string> }
  | { ok: false; name: string; hint: string };

/** Resolve every declared secret of `def`; the first failure wins. */
export async function resolveServiceSecrets(
  def: ServiceDefinition,
  deps: SecretResolverDeps,
): Promise<ServiceSecretsResolution> {
  const values: Record<string, string> = {};
  for (const [name, spec] of Object.entries(def.secrets ?? {})) {
    const r = await resolveSecretRef(spec.ref ?? defaultSecretRef(def.id, name), deps);
    if (!r.ok) return { ok: false, name, hint: `secret ${name}: ${r.hint}` };
    values[name] = r.value;
  }
  return { ok: true, values };
}
