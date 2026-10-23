/**
 * Credential stripping for git remote URLs.
 *
 * A remote such as `https://user:token@github.com/o/r` carries a secret in its
 * userinfo. Anything that builds a link from a remote, or sends a remote off
 * the bridge (vault sync origin), goes through `stripRemoteCredentials` first.
 *
 * Rules (scheme, host, port, path are kept verbatim — never re-serialised, so
 * IPv6 brackets and percent-escapes survive):
 *  - every scheme EXCEPT the ssh family (`http(s)`, `git+https`, `ftps`, `git`, …)
 *    → ALL userinfo removed (there the user part is the token);
 *  - the ssh family (`ssh`, `git+ssh`, `ssh+git`) → the PASSWORD is removed, the
 *    user is kept (`ssh://git:secret@h/o/r` → `ssh://git@h/o/r`: `git` is not a secret);
 *  - scp form `git@host:owner/repo` carries no password → returned unchanged;
 *  - no userinfo → returned unchanged (byte-identical);
 *  - userinfo present but the remainder is not a usable URL (no host) →
 *    `undefined`: the caller sends no origin and builds no links rather than
 *    risk leaking what it could not parse.
 *
 * The output is the RAW shape, never `normalizeOrigin`'s `host/path` form
 * (that is not idempotent: it has no scheme, so re-parsing it yields nothing).
 *
 * See change: harden-bridge-inbound-and-discovery (D18).
 */

const SSH_FAMILY = /^(ssh|git\+ssh|ssh\+git)$/i;
const SCHEMED = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/is;
/** `host` or `[ipv6]`, optional `:port`. */
const HOST_PORT = /^(\[[^\]\s]+\]|[^:@\s[\]]+)(?::\d+)?$/;

export function stripRemoteCredentials(raw: string): string | undefined {
  const m = SCHEMED.exec(raw);
  if (!m) return raw; // scp form, local path, or garbage with no `scheme://`: no URL userinfo to strip
  const [, scheme, authority, rest] = m;
  const at = authority.lastIndexOf("@"); // last: a password may itself contain `@`
  if (at === -1) {
    // A literal `#` / `?` inside a password ends `authority` early, hiding the `@`.
    // If an `@` still sits before the first `/`, we cannot tell where the host starts: fail closed.
    const afterScheme = raw.slice(scheme.length + 3);
    const slash = afterScheme.indexOf("/");
    if ((slash === -1 ? afterScheme : afterScheme.slice(0, slash)).includes("@")) return undefined;
    return raw;
  }
  const userinfo = authority.slice(0, at);
  const hostPort = authority.slice(at + 1);
  if (!HOST_PORT.test(hostPort)) return undefined;
  if (!SSH_FAMILY.test(scheme)) return `${scheme}://${hostPort}${rest}`;
  const colon = userinfo.indexOf(":");
  const user = colon === -1 ? userinfo : userinfo.slice(0, colon);
  return user ? `${scheme}://${user}@${hostPort}${rest}` : `${scheme}://${hostPort}${rest}`;
}
