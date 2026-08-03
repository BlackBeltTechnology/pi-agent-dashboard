# DOX — public

Files in this directory. One row per file. Non-source area (migrated from `docs/file-index-skills-misc.md`; source of truth now here). See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `icon-192.png` | PWA app icon 192x192. Referenced by manifest.json. |
| `icon-512.png` | PWA app icon 512x512. Referenced by manifest.json. |
| `manifest.json` | PWA web app manifest for installability |
| `sw.js` | Minimal service worker for PWA installability. Passes `/api/*` requests through to network (returns without `respondWith`); only non-`/api/` requests get synthetic `503 "Offline"` fallback. See change: fix-openspec-profile-load-race. |
