# skill-provenance.spec.ts — index

L3 for the Resources skills grid (F1-F10, X7). Fulfils `/api/pi-resources` with crafted payloads and drives the `/folder/<enc>/settings/<page>` deep link (no folder pinning needed). Asserts: badges only on `not-loaded` / `loaded-elsewhere`; one flat grid, no grouping; `resource-provenance-filter` narrows to 1 card; session-reported path on a `loaded-elsewhere` card; scan-only + degraded notices with zero badges; convergence on refresh; differing session cwd; Agents + Themes pages unaffected. See change: fix-skill-discovery-parity.
