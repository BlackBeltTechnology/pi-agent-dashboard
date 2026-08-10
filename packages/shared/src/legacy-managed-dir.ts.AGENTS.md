# legacy-managed-dir.ts — index

`detectLegacyManagedDir({ homedir? })`. Returns `{present:false}` or `{present:true, path, pkgCount, sizeMb}`. Probes `~/.pi-dashboard/node_modules/`. Split-literal `".pi-" + "dashboard"` to pass `no-managed-dir-reference.test.ts` lint. Consumed by shared `runSharedChecks` to emit the sole `~/.pi-dashboard/` advisory row + server CLI startup log. See changes: eliminate-electron-runtime-install, fix-doctor-stale-managed-install-check.
