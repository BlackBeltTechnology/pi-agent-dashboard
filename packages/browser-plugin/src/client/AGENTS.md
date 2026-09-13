# DOX — packages/browser-plugin/src/client

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `index.tsx` | Client barrel. Exports `BrowserSettings`, `LiveViewTile`, `isLiveViewActive`, `catalog` for plugin-registry (names match manifest claims). See change: add-browser-relay (task 2.1). |
| `BrowserSettings.tsx` | `settings-section` claim — PLACEHOLDER (renders null). Real profile rows/token paste/kill switch/audit = task 4.1 (workstream 4). |
| `LiveViewTile.tsx` | `content-view` claim — PLACEHOLDER (renders null). Real screencast tile/no-frames overlay/DevTools notice = task 4.3 (workstream 4). |
| `live-view-gate.ts` | `isLiveViewActive(session?) → false` — manifest predicate for the content-view claim (claims MUST be predicate-gated; ungated occludes chat). Real gate (live relay instance) lands with workstreams 2c/4. |
