/**
 * Repository key from a git `origin` URL: the normalised `host[:port]/path` a repository grant is
 * matched against. Pure (no node imports), so the dashboard client can normalise a typed repository
 * the same way the hub normalises a session's origin.
 *
 * SSH, SCP-style and HTTPS spellings of one repository normalise to one key; `file://` and local
 * paths have no key.
 *
 * See change: add-credential-vault (D3); retro-ux-credential-vault (D2: client-side manual entry).
 */

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
