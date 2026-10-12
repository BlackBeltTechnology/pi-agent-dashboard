/**
 * Project key: the identity a grant is matched against.
 *
 * Primary: the normalised `origin` URL (repository key). Fallback: the pair
 * (device id, resolved real path of the session's cwd), matching that exact
 * directory only. Any git failure, and any `file://` / local-path origin, falls
 * back to the directory key. Path case is kept, so `Acme/App` and `acme/app`
 * do not match (fails closed).
 *
 * See change: add-credential-vault (D3).
 */

import { realpathAsync, remoteUrlOrAsync } from "./platform/git.js";

/** What a grant is resolved against for one session. */
export interface SessionProject {
  deviceId: string;
  /** Resolved real path of the session's own cwd. */
  dir: string;
  /** Present only when a readable, non-local origin exists. */
  repoKey?: string;
}

const DEFAULT_PORTS: Record<string, string> = { ssh: "22", https: "443", http: "80" };

interface ParsedOrigin {
  scheme: string;
  host: string;
  port?: string;
  path: string;
}

/** `scheme://[userinfo@]host[:port]/path`; undefined for `file://` and malformed input. */
function parseSchemed(url: string): ParsedOrigin | undefined {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url);
  if (!m) return undefined;
  const scheme = m[1].toLowerCase();
  if (scheme === "file") return undefined;
  const slash = m[2].indexOf("/");
  const authority = slash === -1 ? m[2] : m[2].slice(0, slash);
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const hp = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostPort);
  if (!hp) return undefined;
  return { scheme, host: hp[1], port: hp[2], path: slash === -1 ? "" : m[2].slice(slash) };
}

/** scp form `user@host:path`; the userinfo is what distinguishes it from a local path. */
function parseScp(url: string): ParsedOrigin | undefined {
  const m = /^[^/@\s]+@([^:/\s]+):(.*)$/.exec(url);
  return m ? { scheme: "ssh", host: m[1], path: `/${m[2].replace(/^\/+/, "")}` } : undefined;
}

/** `host[:port]/path` for a remote origin, or undefined (no repository key). */
export function normalizeOrigin(raw: string): string | undefined {
  const url = raw.trim();
  if (!url) return undefined;
  const parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? parseSchemed(url) : parseScp(url);
  if (!parsed?.host) return undefined;
  const path = parsed.path.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (path === "") return undefined;
  const port = parsed.port !== undefined && DEFAULT_PORTS[parsed.scheme] === parsed.port ? undefined : parsed.port;
  return `${parsed.host.toLowerCase()}${port ? `:${port}` : ""}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface ProjectResolveDeps {
  /** Reads `origin`. Resolves undefined on any failure. Default: `git remote get-url origin`. */
  readOrigin?: (cwd: string) => Promise<string | undefined>;
}

/**
 * Resolve a session's project from its OWN cwd. Returns undefined when the
 * directory cannot be resolved, in which case callers deliver nothing.
 */
export async function resolveSessionProject(
  input: { deviceId: string; cwd: string },
  deps: ProjectResolveDeps = {},
): Promise<SessionProject | undefined> {
  const real = await realpathAsync(input.cwd);
  if (real.kind !== "ok") return undefined;
  const readOrigin = deps.readOrigin ?? ((cwd: string) => remoteUrlOrAsync({ cwd }));
  let origin: string | undefined;
  try {
    origin = await readOrigin(real.path);
  } catch {
    origin = undefined;
  }
  const repoKey = origin ? normalizeOrigin(origin) : undefined;
  return { deviceId: input.deviceId, dir: real.path, repoKey };
}
