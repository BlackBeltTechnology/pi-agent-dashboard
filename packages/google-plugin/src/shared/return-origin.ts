/**
 * Which dashboard origins the return page may continue to (scenario-gate B3): `https:` origins or
 * `http://localhost` / `http://127.0.0.1` on any port, no userinfo. The same rule is implemented in
 * `site/oauth/return.html`; the server applies it before it ever puts an origin into a `state`.
 * See change: add-google-connect.
 */
export function allowedReturnOrigin(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
  return null;
}
