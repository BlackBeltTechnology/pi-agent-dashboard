# DOX — packages/craft-web-plugin/src

Directories + shared tests. See change: edit-office-in-pane-with-craft-web.

| File | Purpose |
|------|---------|
| `client/` | `CraftFrameHost` slot component + frame/host protocol — see `client/AGENTS.md`. |
| `server/` | Server entry: provisioning, `serveApp` mounts, status/prepare/csp-report routes, OOXML validator — see `server/AGENTS.md`. |
| `shim/` | `craft-shim.js` copied into each web build — see `shim/craft-shim.js.AGENTS.md`. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `manifest.test.ts` | E1 drift test. Manifest claims vs `server/apps.ts` vs `craft-apps` registry (`webVersion`, `webFidelityNote`, `copySuffix`) vs `OFFICE_SIZE_CAPS`; notice ≤ 300; `validator:true`; configSchema `apps.<app>.enabled` default true. E24 bundling: listed in server `bundledPlugins`, depends on craft-apps, `repository.directory`. |
