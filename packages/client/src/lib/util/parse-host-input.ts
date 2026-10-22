/**
 * Parse a user-supplied host string into a `{ host, port }` pair.
 *
 * Accepts:
 *   - `http://192.168.16.202:8000`
 *   - `https://office-mac.local:8000/some/path`
 *   - `192.168.16.202:8000`
 *   - `office-mac.local`        (uses `defaultPort`)
 *   - `[::1]:8000`              (IPv6 with brackets)
 *
 * Returns `null` if the string cannot be parsed into a non-empty host.
 */
export function parseHostInput(
  input: string,
  defaultPort = 8000,
): { host: string; port: number } | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Try as full URL first if it has a scheme
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    try {
      const u = new URL(raw);
      const host = stripBrackets(u.hostname);
      if (!host) return null;
      const port = u.port ? parseInt(u.port, 10) : defaultPort;
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { host, port };
    } catch {
      return null;
    }
  }

  // IPv6 in brackets: [::1]:8000 or [::1]
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close < 0) return null;
    const host = raw.slice(1, close);
    const rest = raw.slice(close + 1);
    if (!host) return null;
    if (rest === "") return { host, port: defaultPort };
    if (!rest.startsWith(":")) return null;
    const port = parseInt(rest.slice(1), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }

  // host[:port] — split on the LAST colon to keep IPv4 + IPv6 short forms working
  const lastColon = raw.lastIndexOf(":");
  if (lastColon < 0) {
    return { host: raw, port: defaultPort };
  }

  // If there are multiple colons it's likely a bare IPv6 — reject (require brackets)
  if (raw.indexOf(":") !== lastColon) return null;

  const host = raw.slice(0, lastColon);
  const portStr = raw.slice(lastColon + 1);
  if (!host) return null;
  const port = parseInt(portStr, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/**
 * Parse a user-supplied route (address + scheme) for the known-servers list.
 *
 * Like {@link parseHostInput} but scheme-aware: `https://host` → port 443,
 * `http://host` and a bare host → port 8000, an explicit port is always kept
 * (including `:443` / `:80`). Only `http` / `https` are accepted; any other
 * scheme, userinfo, or a path on a scheme-less input yields `null`.
 * `parseHostInput` is unchanged (client-only helper).
 *
 * See change: group-servers-by-identity (D6, test-plan #E9).
 */
export function parseRouteInput(
  input: string,
): { host: string; port: number; scheme: "http" | "https" } | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let scheme: "http" | "https" = "http";
  let authority = raw;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(raw);
  if (m) {
    const s = m[1].toLowerCase();
    if (s !== "http" && s !== "https") return null;
    scheme = s;
    authority = m[2].replace(/[/?#].*$/, "");
  }
  if (!authority || /[/?#@\s]/.test(authority)) return null;
  const parsed = parseHostInput(authority, scheme === "https" ? 443 : 8000);
  return parsed ? { ...parsed, scheme } : null;
}

function stripBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}
