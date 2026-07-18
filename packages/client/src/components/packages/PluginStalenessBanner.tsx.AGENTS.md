# PluginStalenessBanner.tsx — index

Banner on stale plugin bundle. Fetches `/api/health.bundleHash` on mount. Compares to imported `PLUGIN_REGISTRY_HASH`. Mismatch ⇒ banner with Refresh (`location.reload()`) + Dismiss buttons. Dismiss persists in `sessionStorage` key `pi-plugin-staleness-dismissed`. No new REST route, no new WS message. See change: fix-pi-flows-end-to-end.
