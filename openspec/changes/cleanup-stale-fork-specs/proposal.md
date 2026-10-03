## Why

> Follow-up drift recorded by `drop-mariozechner-pi-fork` (task 7.7).

`drop-mariozechner-pi-fork` removed the legacy `@mariozechner/pi-coding-agent` fork from code and from every live capability spec. It intentionally left some requirements that still name the fork. Those requirements describe code that `eliminate-electron-runtime-install` already deleted:
- `bootstrapInstall`, `installStandalone`, `dependency-installer.ts`;
- power-user install, the offline cache, `offline-packages.json`;
- `resolveJitiFromPi`.

Re-asserting obsolete contracts under a renamed package would be wrong. These requirements must be removed instead.

Planning found more stale loader and launch requirements in the same capabilities. They name deleted resolvers (`resolveJitiImport`, `resolveJitiFromAnchor`) or the deleted `extracted` launch source. They also assert an entry-URL-wrap rule the code contradicts, which `server-launch` repeats. Leaving them would contradict this change's replacement text, so they are fixed here too.

## What Changes

- Remove the stale requirements, retiring a capability when every requirement in it is dead:
  - `bootstrap-install` (all) and `dependency-installer` (all);
  - `dashboard-server` "Bootstrap install lists exclude tsx";
  - `electron-shell`: tsx launch, power-user install, extracted-LaunchSource health check;
  - `electron-build-pipeline` "excludes pi-coding-agent" (pi is bundled now) and "Bundled-extensions step in publish workflow" (its scripts are gone).
- Replace (REMOVED + ADDED under a corrected name) the live requirements whose scenario titles state wrong behaviour:
  - `dashboard-server` "Centralized helper…" and "TypeScript loader passed as file:// URL" → "Canonical Node ESM-loader argv helpers";
  - `electron-shell` `shouldUrlWrapEntry()` contract → "`shouldUrlWrapEntry()` documents the jiti URL-entry breakage";
  - `electron-build-pipeline` "Bundled dashboard server" → "…ships the pi runtime".
- Correct (MODIFIED, titles kept) the bodies of:
  - `dashboard-server` "CI detects raw paths passed to Node ESM loader" and "CLI bin entry resolves jiti at runtime";
  - `electron-build-pipeline` "NSIS install location is bootstrap-agnostic" and "Local builder produces correct artifacts across arches";
  - `electron-shell` "Electron main process lifecycle" (no tsx-binary launch) and "Doctor diagnostic function" (no offline-bundle check);
  - `server-launch` "Single shared dashboard-server spawn primitive", which becomes the single owner of the entry-wrap rule and has accurate argv-ownership exceptions and restart env.
- Add `dashboard-server` "Startup fails hard when pi cannot be resolved", the live successor of the removed degraded-mode requirement.
- Each REMOVED block carries Reason and Migration, citing `eliminate-electron-runtime-install` or the successor requirement. `.openspec.yaml` sets `retire_capabilities: true`.

## Capabilities

### Modified Capabilities
- `bootstrap-install`: all 14 requirements REMOVED; capability retired.
- `dependency-installer`: all 7 requirements REMOVED; capability retired. Surviving detection is owned by `electron-doctor-diagnostics`.
- `dashboard-server`: 3 REMOVED, 2 ADDED, 2 MODIFIED.
- `electron-shell`: 4 REMOVED, 1 ADDED, 2 MODIFIED.
- `electron-build-pipeline`: 3 REMOVED, 1 ADDED, 2 MODIFIED.
- `server-launch`: 1 MODIFIED (entry-wrap scenario).

## Impact

- **Specs only for production code.** Test-only additions are allowed where a rewritten scenario lacks coverage.
- Archiving deletes `openspec/specs/bootstrap-install/` and `openspec/specs/dependency-installer/`. That can be undone only through git.
- Out of scope, recorded as follow-up:
  - `@mariozechner` mentions in 11 other capabilities;
  - the `bundled-recommended-extensions` references to `dependency-installer.ts` and the deleted `bundle-recommended-extensions.sh`;
  - `electron-launch-source` deleted kinds;
  - the `doctor-core.ts` TypeScript-loader row;
  - dead `bootstrap-state` protocol types.
- **Depends on** `drop-mariozechner-pi-fork` (archived).

## Discipline Skills

- `doubt-driven-review`: retiring two capabilities deletes spec directories on archive, an irreversible step without git. It runs as part of `plan-proposal`.

No other discipline applies: no auth, latency, endpoint or runtime change.
