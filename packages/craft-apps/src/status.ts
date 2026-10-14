/**
 * `pi-craft status` — per-app installed versions, cache size, the version that
 * would be used and the active source. Reads the local cache only: it never
 * touches the network and never downloads.
 *
 * See change: add-craft-apps-core (craft-cli-entrypoint "apps and status").
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  cacheRoot,
  craftSource,
  installedVersions,
  type ProvisionDeps,
  type ProvisionSource,
  readLatestCache,
  normaliseVersion,
  type CraftSource,
} from "./provision.js";
import { type CraftApp, envPrefix } from "./registry.js";

export interface AppStatus {
  app: CraftApp["id"];
  name: string;
  installed: string[];
  cacheBytes: number;
  /** What a run would resolve right now without asking GitHub; `version: null` = would download the latest release. */
  wouldUse: { version: string | null; source: ProvisionSource | "download" };
  source: CraftSource;
  override?: string;
}

type StatusDeps = Pick<ProvisionDeps, "env" | "platform" | "homedir" | "now">;

function dirBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirBytes(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    } catch {
      /* raced with a removal */
    }
  }
  return total;
}

export function appStatus(app: CraftApp, deps: StatusDeps): AppStatus {
  const root = cacheRoot(app, deps);
  const installed = installedVersions(app, root, deps.platform);
  const source = craftSource(deps.env);
  const prefix = envPrefix(app);
  const override = deps.env[`${prefix}_BIN`];
  const pin = deps.env[`${prefix}_VERSION`]?.trim();
  let wouldUse: AppStatus["wouldUse"];
  if (override) wouldUse = { version: null, source: "override" };
  else if (pin) wouldUse = { version: normaliseVersion(pin, app.name), source: "pin" };
  else {
    const cached = readLatestCache(root, deps.now());
    if (cached) wouldUse = { version: normaliseVersion(cached, app.name), source: "latest-cached" };
    else wouldUse = { version: null, source: "download" };
  }
  return { app: app.id, name: app.name, installed, cacheBytes: dirBytes(root), wouldUse, source, ...(override ? { override } : {}) };
}
