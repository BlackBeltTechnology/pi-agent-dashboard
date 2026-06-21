/**
 * automation-plugin · bridge entry.
 *
 * The automation engine is server-owned (central scheduler), so the bridge
 * entry is intentionally a no-op in phase 1. It exists so the manifest's
 * `bridge` path resolves and the package mirrors the `flows-plugin` layout.
 * Future event-trigger kinds (phase 2) that need per-session bridge signals
 * would wire here.
 *
 * See change: add-automation-plugin.
 */
export default function activate(_ctx: unknown): void {
  // No-op: automation triggers fire from the server-side scheduler.
}
