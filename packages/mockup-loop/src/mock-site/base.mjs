// @ts-check
// Base-path helpers for the mock site (D11). A `base` is explicit (`serve_mock_site{base}`, `--base`) or host-answered
// (`mock-site:base-reservation`); both pass the SAME allowlist. See change: serve-live-previews-on-capability-origin (D11).

/** Allowlist: `/seg/` repeated, segments of unreserved characters only (no `?`, `#`, `\`, `%`, spaces, control or non-ASCII). */
const BASE_SHAPE = /^\/([A-Za-z0-9._~-]+\/)+$/;
const BASE_MAX = 256;
const BASE_HELP = 'base must start and end with "/" and use only letters, digits and . _ ~ - in its segments, e.g. "/some/prefix/" (max 256 characters, no "." or ".." segment)';

/**
 * `"/"` means "no base" (the site starts at root); anything else must match the allowlist.
 * @param {unknown} v
 * @returns {{ ok: true, base: string | null } | { ok: false, error: string }}
 */
export function validateBase(v) {
  if (typeof v !== "string") return { ok: false, error: `invalid base: ${BASE_HELP}` };
  if (v === "/") return { ok: true, base: null };
  if (v.length > BASE_MAX || !BASE_SHAPE.test(v) || v.split("/").some((s) => s === "." || s === "..")) return { ok: false, error: `invalid base: ${BASE_HELP}` };
  return { ok: true, base: v };
}

/**
 * Join a site URL and a relative path with exactly one `/` between them.
 * @param {string} url @param {string} rel
 */
export function joinUrl(url, rel) {
  return `${url.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}
