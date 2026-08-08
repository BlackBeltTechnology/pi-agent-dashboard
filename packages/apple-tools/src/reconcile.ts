/**
 * Server-side path reconciliation (Decision 1). When the server's check
 * discovers imcp-server at a non-default candidate, persist it to the
 * `imcpServerPath` config key — but ONLY when the configured value is unset or
 * still at the schema default. An explicit operator override is never
 * overwritten (its file may legitimately be absent at check time).
 *
 * Pure function so the guard is unit-testable (#E33). The actual write is done
 * by the caller via `updatePluginConfig` (server owns the store).
 *
 * See change: add-apple-tools-imcp-plugin.
 */

/** The canonical /Applications location, also the configSchema default. */
export const DEFAULT_IMCP_PATH = "/Applications/iMCP.app/Contents/MacOS/imcp-server";

/**
 * Should the discovered path be written back to `imcpServerPath`?
 * True only when discovery found a real, different path AND the configured
 * value is unset/empty or still at the default. False for an explicit override.
 */
export function shouldReconcilePath(
  configured: string | undefined,
  discovered: string | null,
): discovered is string {
  if (!discovered) return false;
  if (discovered === configured) return false;
  return configured === undefined || configured === "" || configured === DEFAULT_IMCP_PATH;
}
