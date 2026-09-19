/**
 * Configured `auth.bypassUrls` prefix matching.
 *
 * Extracted to a LEAF module (no imports of its own) because two callers now
 * compare against the bypass list — the OAuth auth plugin and the universal
 * network guard — and the guard must not import the plugin, which already
 * imports the guard (that would be a cycle). Same precedent as
 * `cleanup-import-cycles` extracting `auth/loopback.ts`.
 *
 * The two callers MUST agree on this predicate: the guard admits a bypassed
 * `/api` path via the same prefix rule the plugin uses to skip its own
 * authentication, so a divergence would open or close one of the two paths.
 * See change: add-universal-network-guard.
 */

/**
 * Returns true if the request path matches any of the configured bypass prefixes.
 * Exported for unit testing.
 */
export function isBypassed(url: string, bypassUrls: string[]): boolean {
  return bypassUrls.some((prefix) => url.startsWith(prefix));
}
