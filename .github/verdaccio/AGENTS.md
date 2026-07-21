# DOX — .github/verdaccio

Files in this directory. One row per file. Non-source area.

| File | Purpose |
|------|---------|
| `config.yml` | Verdaccio config, nightly round-trip (change: add-nightly-verdaccio-build). Ephemeral loopback registry. `_electron-build.yml` starts it per Electron leg when `registry_url` set. `uplinks.npmjs` → https://registry.npmjs.org/. `packages['@blackbelt-technology/*']`: `access/publish/unpublish $all`, **no `proxy`** — local-only shadow. Local `<base>` publish avoids EPUBLISHCONFLICT vs public `<base>`. `^<base>` resolves just-published working-tree source → nightly tests UNRELEASED code. `packages['**']`: `access/publish $all` + `proxy: npmjs` — third-party deps proxy + cache public npm. `listen: 127.0.0.1:4873` (loopback bind, unauthenticated registry never public). Anonymous, no token. `web.enable: false`. See design Decision 2. |
