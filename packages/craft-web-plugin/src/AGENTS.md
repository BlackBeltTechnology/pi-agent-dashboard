# DOX — packages/craft-web-plugin/src

Directories + shared tests. See change: edit-office-in-pane-with-craft-web.

| File | Purpose |
|------|---------|
| `client/` | `CraftFrameHost` slot component + frame/host protocol — see `client/AGENTS.md`. |
| `server/` | Server entry: provisioning, `serveApp` mounts, status/prepare/csp-report routes, OOXML validator — see `server/AGENTS.md`. |
| `shared/` | Adapter profiles (one declarative row per app) + profile rule checks, imported by server AND client — see `shared/AGENTS.md`. See change: extend-craft-web-to-all-apps. |
| `shim/` | `craft-shim.js` copied into each web build — see `shim/craft-shim.js.AGENTS.md`. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `manifest.test.ts` | D2 drift test. Manifest claims ↔ profile claims (id, exts, mode, `siblingExtensions`, `maxBytes`) ↔ server/client tables ↔ registry `webVersion`/`webFidelityNote`/name; caps per ext (`capForExtension`); edit `copySuffix`=appId, `validator:true`, label `Edit in <App>` / preview `View in <App>`; notice = fidelity note, no-title apps prefixed with the unconfirmed-open check (E28), ≤ 300; `keepAlive {max:3}`; `profileErrors` clean; E2 fallback bounds, E3 one craft mode per ext; configSchema app keys per profile. E24 bundling. See change: extend-craft-web-to-all-apps. |
