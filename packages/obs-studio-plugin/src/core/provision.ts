/**
 * `pi-obs provision` (design D3): build the service definition and submit it
 * through `pi-dashboard service add --file` (the CLI owns the dry-run review,
 * confirmation and local credential proof).
 *
 * Local (`attached`, default id `obs`, at most ONE per host): `origin: "user"`,
 * `ws-first-message` health, `process.name` adoption, start argv = absolute
 * node + absolute `pi-obs` entry + `launch` (never a shim: win32 `.cmd` cannot
 * spawn with `shell: false`), NO `lifecycle.stop`, `idleStopMinutes: null`, and
 * a password slot `store:<id>/password` WITHOUT `env` (never injected into OBS).
 * Remote (`external`, id `obs-<slug>`): endpoint + health + password slot.
 *
 * Refusals: a second local instance (names the existing one), an id whose
 * `SVC_<ID>_` env name collides with an existing service. Non-loopback `ws://`
 * warns BEFORE the review. The definition goes through a 0600 temp file that is
 * deleted afterwards. Order: add → websocket config → secret set → verify.
 * See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SERVICE_ID_PATTERN, type ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { isLoopbackUrl } from "./connection.js";
import type { DashboardCli } from "./dashboard-cli.js";
import { ObsError } from "./errors.js";
import { addInstance, readInstances } from "./instances.js";
import { type Platform, processName } from "./paths.js";
import { envNameCollision } from "./service-defs.js";

export const LOCAL_ID = "obs";

export interface LocalDefInput {
  id: string;
  platform: Platform;
  port: number;
  nodePath: string;
  entryPath: string;
}

export function localDefinition(i: LocalDefInput): ServiceDefinition {
  return {
    id: i.id,
    mode: "attached",
    description: "OBS Studio on this host (pi-obs)",
    endpoints: { ws: `ws://127.0.0.1:${i.port}` },
    health: { kind: "ws-first-message", endpoint: "ws" },
    process: { name: processName(i.platform) },
    lifecycle: { start: { [i.platform]: [i.nodePath, i.entryPath, "launch"] } },
    secrets: { password: { ref: `store:${i.id}/password` } },
    idleStopMinutes: null,
    origin: "user",
  };
}

export function remoteDefinition(id: string, url: string): ServiceDefinition {
  return {
    id,
    mode: "external",
    description: `OBS Studio at ${url} (pi-obs)`,
    endpoints: { ws: url },
    health: { kind: "ws-first-message", endpoint: "ws" },
    secrets: { password: { ref: `store:${id}/password` } },
    origin: "user",
  };
}

/** `ws://10.0.0.5:4455` → `obs-10-0-0-5-4455`. */
export function remoteId(url: string): string {
  const u = new URL(url);
  const slug = `${u.hostname}-${u.port || "4455"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `obs-${slug}`.slice(0, 63).replace(/-+$/, "");
}

function insecureWarning(url: string): string | undefined {
  if (!url.startsWith("ws://") || isLoopbackUrl(url)) return undefined;
  return `obs-websocket traffic to ${new URL(url).host} is unencrypted (plain ws://): the password challenge, scene data and screenshots cross the network in clear; use it only on a trusted LAN or through a tunnel`;
}

export interface SubmitDeps {
  cli: DashboardCli;
  defs: readonly ServiceDefinition[];
  state: string;
  warn: (line: string) => void;
  yes?: boolean;
  update?: boolean;
  tmpDir?: string;
}

/** Validate refusals, then `service add --file` via a 0600 temp file (deleted after). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ordered refusals followed by one submit
export async function submitDefinition(def: ServiceDefinition, d: SubmitDeps): Promise<void> {
  const collision = envNameCollision(d.defs, def.id);
  if (collision) {
    throw new ObsError("refused", `service id ${def.id} maps to the same secret env name as the existing service ${collision} (SVC_<ID>_ folds '-' and '_'); pick another --service`);
  }
  if (!SERVICE_ID_PATTERN.test(def.id)) throw new ObsError("usage", `invalid service id ${JSON.stringify(def.id)} (lowercase letters, digits, '-')`);
  const exists = d.defs.some((x) => x.id === def.id);
  if (exists && !d.update) throw new ObsError("refused", `service ${def.id} already exists; pass --update to replace its definition`);
  if (def.mode === "attached") {
    const registered = new Set(readInstances(d.state, (id) => d.defs.some((x) => x.id === id)));
    const local = d.defs.find((x) => x.id !== def.id && x.mode === "attached" && (registered.has(x.id) || x.process?.name === def.process?.name));
    if (local) throw new ObsError("refused", `a local OBS service already exists: ${local.id} (one local OBS per host; use --update --service ${local.id})`);
  }
  const warning = def.endpoints?.ws ? insecureWarning(def.endpoints.ws) : undefined;
  if (warning) d.warn(warning);

  const dir = fs.mkdtempSync(path.join(d.tmpDir ?? os.tmpdir(), "pi-obs-def-"));
  const file = path.join(dir, `${def.id}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(def, null, 2), { mode: 0o600 });
    if (exists && d.update) {
      // A directly submitted definition has no in-place update: remove, then re-add
      // (the secret goes with it and is set again by the provisioning steps that follow).
      d.warn(`--update: removing ${def.id} before re-adding it; its stored password is set again afterwards`);
      const rm = await d.cli.run(["service", "remove", def.id]);
      if (rm.code !== 0) throw new ObsError("failed", `pi-dashboard service remove ${def.id} exited ${rm.code}; nothing was changed`);
    }
    const args = ["service", "add", "--file", file, ...(d.yes ? ["--yes"] : [])];
    const r = await d.cli.run(args, { inherit: true });
    if (r.code !== 0) throw new ObsError("failed", `pi-dashboard service add exited ${r.code} (cancelled or refused); nothing was registered`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  addInstance(d.state, def.id);
}
