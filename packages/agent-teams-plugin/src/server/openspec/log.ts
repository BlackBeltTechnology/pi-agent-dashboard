/**
 * Structured logs and counters of the OpenSpec profile modules (design "Structured logs and counters").
 * A line carries ids, codes and numbers only: `agent-teams: openspec <event> team=<id> k=v …`. No task text
 * ever reaches a field, and any string value is credential-redacted, stripped of whitespace/control
 * characters and capped, so a stray git stderr line or a repository-controlled string cannot leak.
 * See change: add-agent-teams-openspec.
 */
import type { PluginCounters } from "../templates-hooks.js";
import type { Logger } from "../types.js";

/** Counter names (per team + `*` total through `PluginCounters`, so they show in the snapshot `stats`). */
export const OPENSPEC_COUNTERS = {
  seeded: "openspec_seeded",
  seedIncomplete: "openspec_seed_incomplete",
  launched: "openspec_launched",
  launchFailed: "openspec_launch_failed",
  completionVerified: "openspec_completion_verified",
  completionRefused: "openspec_completion_refused",
  syncOk: "openspec_sync_ok",
  syncFailed: "openspec_sync_failed",
  lockGranted: "openspec_lock_granted",
  lockWaited: "openspec_lock_waited",
  lockExpired: "openspec_lock_expired",
  sidecarWriteFailed: "openspec_sidecar_write_failed",
  sidecarMissing: "openspec_sidecar_missing",
  preflightRefused: "openspec_preflight_refused",
} as const;
type OpenspecCounter = (typeof OPENSPEC_COUNTERS)[keyof typeof OPENSPEC_COUNTERS];

type FieldValue = string | number | boolean | undefined;
type LogFields = Readonly<Record<string, FieldValue>>;
type LogLevel = "info" | "warn" | "error";

const MAX_FIELD_CHARS = 80;

/** Remove credentials from free text: `scheme://user:pass@host`, `Bearer …`, `token=…`/`password=…`. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@")
    .replace(/\bBearer\s+\S+/gi, "Bearer ***")
    .replace(/\b((?:access_|auth_|api[_-]?)?(?:token|password|passwd|secret|apikey)=)[^\s&]+/gi, "$1***");
}

/** One log field value: redacted, whitespace and control characters collapsed to `_`, capped. */
export function safeField(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  let out = "";
  for (const ch of redactSecrets(value)) {
    const c = ch.codePointAt(0) as number;
    out += c <= 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? "_" : ch;
    if (out.length >= MAX_FIELD_CHARS) break;
  }
  return out;
}

export interface OpenspecLog {
  /** One structured line (`agent-teams: openspec <event> team=<id> k=v`). */
  event(level: LogLevel, event: string, teamId: string | undefined, fields?: LogFields): void;
  /** Increment a counter (per team when `teamId` is given). */
  count(counter: OpenspecCounter, teamId?: string, n?: number): void;
  /** `event` + `count` in one call (the usual shape: one line and one counter per outcome). */
  record(level: LogLevel, event: string, counter: OpenspecCounter, teamId: string | undefined, fields?: LogFields): void;
}

export function createOpenspecLog(deps: { logger: Logger; counters?: PluginCounters }): OpenspecLog {
  const count: OpenspecLog["count"] = (counter, teamId, n = 1) => deps.counters?.inc(counter, teamId, n);
  const event: OpenspecLog["event"] = (level, name, teamId, fields = {}) => {
    const parts = [`agent-teams: openspec ${safeField(name)}`];
    if (teamId !== undefined) parts.push(`team=${safeField(teamId)}`);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) parts.push(`${safeField(k)}=${safeField(v)}`);
    deps.logger[level](parts.join(" "));
  };
  return {
    event,
    count,
    record(level, name, counter, teamId, fields) {
      event(level, name, teamId, fields);
      count(counter, teamId);
    },
  };
}
