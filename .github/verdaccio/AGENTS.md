# DOX — .github/verdaccio

Files in this directory. One row per file. Non-source area.

| File | Purpose |
|------|---------|
| `config.yml` | Verdaccio config for the nightly Verdaccio round-trip (change: add-nightly-verdaccio-build). Ephemeral loopback-only private registry started per Electron leg by `_electron-build.yml` when `registry_url` is set. `uplinks.npmjs` → https://registry.npmjs.org/. `packages['@blackbelt-technology/*']` = `access/publish/unpublish $all` with **no `proxy`** (LOCAL-ONLY shadow: a `<base>` publish can't EPUBLISHCONFLICT the public `<base>`, and `^<base>` specifiers resolve to the just-published working-tree source → nightly tests UNRELEASED code). `packages['**']` = `access/publish $all` + `proxy: npmjs` (third-party deps resolve + cache from public npm). `listen: 0.0.0.0:4873`, reached via http://localhost:4873; anonymous (no token). `web.enable: false`. See design Decision 2. |
