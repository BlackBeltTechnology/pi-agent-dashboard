/**
 * Server-side shared types: the logger, the host session record narrowing and
 * the caller context every op receives.
 * See change: add-agent-teams-core.
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { ownerKeyFrom } from "../shared/owner-key.js";

export type Logger = ServerPluginContext["logger"];

/** A logger that discards everything (tests, defaults). */
export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

/**
 * Narrowing of `sessionManager.getSession(id)` (typed `unknown` by the host,
 * `server-context.ts:45`), after `team-plugin/src/server/conversations.ts:38-46`.
 */
export interface HostSession {
  cwd?: string;
  sessionFile?: string;
  /** Owner KEY (`ownerKeyOf`) of the host record's `{iss, sub}` principal owner. */
  principalOwner?: string;
  /** Plugin refs the host resolved for this session (key = plugin id). */
  pluginRefs?: Record<string, unknown>;
  name?: string;
  status?: string;
}

export type HostSessionLookup = (sessionId: string) => HostSession | undefined;

/** Narrow the host's `unknown` session record to `HostSession` (never throws). */
export function narrowHostSession(raw: unknown): HostSession | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: HostSession = {};
  if (typeof r.cwd === "string") out.cwd = r.cwd;
  if (typeof r.sessionFile === "string") out.sessionFile = r.sessionFile;
  const owner = ownerKeyFrom(r.principalOwner); // the host record holds an `{iss, sub}` object
  if (owner !== undefined) out.principalOwner = owner;
  if (typeof r.name === "string") out.name = r.name;
  if (typeof r.status === "string") out.status = r.status;
  if (r.pluginRefs !== null && typeof r.pluginRefs === "object") out.pluginRefs = r.pluginRefs as Record<string, unknown>;
  return out;
}

/** Who may perform an actor operation (`ops.ts`). */
export type Actor = "lead" | "user" | "server";
