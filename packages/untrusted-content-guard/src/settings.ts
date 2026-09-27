/**
 * Settings (design D5 + D7). Read from pi settings under the key
 * `untrusted-content-guard`: global `<agentDir>/settings.json`, then the
 * project `.pi/settings.json` — the latter ONLY when the project is trusted, so
 * an untrusted repository cannot switch the guard off.
 *
 * Precedence: defaults ← global ← project (field-wise). `preset: "strict"` then
 * adds `write`/`edit` to `sensitiveTools` and sets `taintScope: "session"`
 * unless `taintScope` was set explicitly.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type GuardMode = "off" | "warn" | "strip" | "block";
type TaintScope = "run" | "session";

export interface GuardSettings {
  mode: GuardMode;
  untrustedTools: string[];
  sensitiveTools: string[];
  allowHosts: string[];
  taintScope: TaintScope;
  preset?: "strict";
}

const SETTINGS_KEY = "untrusted-content-guard";

export const DEFAULT_SETTINGS: Readonly<GuardSettings> = Object.freeze({
  mode: "strip",
  untrustedTools: ["fetch_content", "web_search", "get_search_content"],
  sensitiveTools: ["bash", "*_send", "*_reply", "*_delete", "*_trash", "*_modify"],
  allowHosts: [],
  taintScope: "run",
});

const MODES: readonly GuardMode[] = ["off", "warn", "strip", "block"];
const SCOPES: readonly TaintScope[] = ["run", "session"];

type Partial_ = Partial<GuardSettings>;

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
}

/** Validate one raw settings object; invalid fields are dropped. */
function sanitize(raw: unknown): Partial_ {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial_ = {};
  if (MODES.includes(r.mode as GuardMode)) out.mode = r.mode as GuardMode;
  if (SCOPES.includes(r.taintScope as TaintScope)) out.taintScope = r.taintScope as TaintScope;
  if (r.preset === "strict") out.preset = "strict";
  const untrusted = stringList(r.untrustedTools);
  if (untrusted) out.untrustedTools = untrusted;
  const sensitive = stringList(r.sensitiveTools);
  if (sensitive) out.sensitiveTools = sensitive;
  const hosts = stringList(r.allowHosts);
  if (hosts) out.allowHosts = hosts;
  return out;
}

/** Merge raw `untrusted-content-guard` objects (lowest precedence first) onto the defaults. */
export function resolveSettings(...layers: unknown[]): GuardSettings {
  const merged: Partial_ = {};
  for (const layer of layers) Object.assign(merged, sanitize(layer));
  const settings: GuardSettings = {
    mode: merged.mode ?? DEFAULT_SETTINGS.mode,
    untrustedTools: merged.untrustedTools ?? [...DEFAULT_SETTINGS.untrustedTools],
    sensitiveTools: merged.sensitiveTools ?? [...DEFAULT_SETTINGS.sensitiveTools],
    allowHosts: merged.allowHosts ?? [...DEFAULT_SETTINGS.allowHosts],
    taintScope: merged.taintScope ?? DEFAULT_SETTINGS.taintScope,
  };
  if (merged.preset === "strict") {
    settings.preset = "strict";
    for (const tool of ["write", "edit"]) {
      if (!settings.sensitiveTools.includes(tool)) settings.sensitiveTools.push(tool);
    }
    settings.taintScope = merged.taintScope ?? "session";
  }
  return settings;
}

function agentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) return env.startsWith("~") ? path.join(os.homedir(), env.slice(1)) : env;
  return path.join(os.homedir(), ".pi", "agent");
}

function readKey(file: string): unknown {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return json?.[SETTINGS_KEY];
  } catch {
    return undefined; // absent or malformed settings file → no layer
  }
}

/** Load effective settings from disk. `projectTrusted=false` skips the project layer. */
export function loadSettings(cwd: string | undefined, projectTrusted: boolean): GuardSettings {
  const global = readKey(path.join(agentDir(), "settings.json"));
  const project = cwd && projectTrusted ? readKey(path.join(cwd, ".pi", "settings.json")) : undefined;
  return resolveSettings(global, project);
}
