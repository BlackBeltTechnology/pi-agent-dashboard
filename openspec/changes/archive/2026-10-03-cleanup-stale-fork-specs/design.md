## Context

`drop-mariozechner-pi-fork` left fork-naming requirements in five capabilities (see proposal.md, Why). The doubt review found more stale loader and launch requirements in the same area. Their wording contradicts the code, and it would contradict this change's replacement text. In-scope decision (user, option A): fix that drift here too, so `server-launch` joins as a sixth capability.

Code facts the specs are rewritten against:
- Entry-wrap rule: `shouldUrlWrapEntry` returns `false` for tsx and jiti on every platform. It URL-wraps other loaders on `win32` only (`packages/shared/src/platform/node-spawn.ts:158-164`). It is pinned by `node-spawn.test.ts` (the `buildNodeImportArgvParts` describe, about line 182) and `node-spawn-jiti-contract.test.ts`.
- Argv builder: `buildNodeImportArgvParts` is the single pure argv builder (`node-spawn.ts:198`). `spawnNodeScript` delegates to it (`node-spawn.ts:213-222`).
- CLI wrapper: `packages/server/bin/pi-dashboard.mjs:67-100` resolves jiti inline with `createRequire` over `JITI_PACKAGES`. A miss exits 1 with a "cannot find jiti … may be corrupted" message.
- Lint: `no-raw-node-import.test.ts:21-29` allowlists two *files* plus an opt-out marker. No function name is allowlisted, despite the stale doc comment at about line 44.
- Startup: `packages/server/src/cli.ts:252-279` resolves `pi` through the tool registry. A miss throws "corrupted node_modules/ tree". There is no degraded mode.
- Launch source: `packages/electron/src/lib/launch-source.ts:1-25` lists the kinds `attach | devMonorepo | localLink | overlay | bundled`. `extracted` is gone.
- Bundle: `packages/electron/scripts/bundle-server.mjs:100-105` sets `BUNDLED_WORKSPACE_PKGS` to server, shared, extension and dashboard-plugin-runtime. The synthetic `package.json` has no `dependencies` (about lines 194-201). pi, openspec and tsx come from `packages/server/package.json` (lines 70, 79, 96).
- Bootstrap: `bootstrapInstall`, `installStandalone`, `resolveTsLoader`, `installRecommendedExtensions`, `resolveJitiFromPi`, `extractLaunchSource` and `/api/bootstrap/*` have no live code. `cli-no-bootstrap-references.test.ts` forbids reintroducing them in `cli.ts`.

| Capability | Requirement | Action |
|---|---|---|
| `bootstrap-install` | all 14 | REMOVE → retire |
| `dependency-installer` | all 7 (live detection is owned by `electron-doctor-diagnostics`) | REMOVE → retire |
| `dashboard-server` | Bootstrap install lists exclude tsx | REMOVE |
| `dashboard-server` | Centralized helper…; TypeScript loader passed as file:// URL | REMOVE + ADD "Canonical Node ESM-loader argv helpers" |
| `dashboard-server` | — (degraded mode's live successor had no requirement) | ADD "Startup fails hard when pi cannot be resolved" |
| `dashboard-server` | CI detects raw paths…; CLI bin entry resolves jiti… | MODIFY (titles kept, bodies corrected) |
| `electron-shell` | tsx launch; power-user install; extracted LaunchSource | REMOVE |
| `electron-shell` | `shouldUrlWrapEntry()` documents jiti version contract | REMOVE + ADD "…documents the jiti URL-entry breakage" (doc-comment contract only; the rule references `server-launch`) |
| `electron-shell` | Electron main process lifecycle (launch "using the `tsx` binary"); Doctor diagnostic function ("offline packages bundle") | MODIFY |
| `electron-build-pipeline` | excludes pi-coding-agent; Bundled-extensions step in publish workflow | REMOVE |
| `electron-build-pipeline` | Bundled dashboard server | REMOVE + ADD "…ships the pi runtime" |
| `electron-build-pipeline` | NSIS install location is bootstrap-agnostic | MODIFY (`extracted` → `bundled`) |
| `electron-build-pipeline` | Local builder produces correct artifacts across arches | MODIFY (drop `resources/offline-packages/`; `bundle-server.sh` → `.mjs`) |
| `server-launch` | Single shared dashboard-server spawn primitive | MODIFY: entry-wrap scenario; argv-ownership exceptions (`bin/pi-dashboard.mjs`, `fit-worker-pool.ts` opt-out); restart env = `buildRestartEnv` |

## Goals / Non-Goals

**Goals:**
- After archive, no requirement in the six capabilities asserts `@mariozechner/*` as a live dependency, or names a deleted symbol as live. Negative guards ("SHALL NOT contain the fork") are allowed.
- The entry-wrap rule has exactly one owner, `server-launch`. `dashboard-server` and `electron-shell` reference it instead of restating it.
- Every live behaviour that loses a requirement names its successor.

**Non-Goals:**
- Production code changes. Test-only additions are allowed where a rewritten scenario lacks coverage.
- Dead leftovers. They are recorded, not deleted:
  - `bootstrap-state` types in `browser-protocol.ts`;
  - stale comments in `bundle-server.mjs`, `tool-registry/definitions.ts` and `no-raw-node-import.test.ts`.
- `@mariozechner` mentions in the other 11 capabilities. `JITI_PACKAGES` still lists `@mariozechner/jiti` as a deliberate fallback (`binary-lookup.ts:29-32`), so those specs need a careful, separate audit.
- Other drift goes to the follow-up record:
  - `bundled-recommended-extensions` "First-run activation…", which still cites `dependency-installer.ts`, and "Build-time bundling script", which still requires the deleted `bundle-recommended-extensions.sh`;
  - `electron-launch-source` "Uniform spawn primitive", which lists the deleted kinds `piExtension`/`npmGlobal`/`extracted`;
  - `server-launch` "Removed predecessors", phrased as pending ("SHALL be removed once…") although the removal is done;
  - `dashboard-server` "Doctor does not probe for tsx", which is scoped to `electron/src/lib/doctor.ts`, while shared `doctor-core.ts` (about line 1285) still reports a "TypeScript loader" row that may probe system tsx.

## Decisions

- **REMOVE rather than rename the package in place.** Swapping the fork's package name would re-assert contracts for code that no longer exists.
- **Retire `dependency-installer` instead of keeping "Detect installed CLI tools".** `electron-doctor-diagnostics` already owns the surviving detector. Keeping a duplicate would split ownership.
- **REPLACE (REMOVED + ADDED) when a stale scenario title must go; MODIFY when the titles are still true.** `openspec validate` rejects a MODIFIED block that drops a current scenario title. *Alternative:* keep the titles verbatim with a NOTE (precedent: `catch-all-event-forwarding`). Rejected where the title itself states the wrong behaviour.
- **`server-launch` owns the entry-wrap rule; `dashboard-server` owns the pure helpers.** This removes the duplicate rule the review flagged. The helper requirement's entry scenario is a formula over `shouldUrlWrapEntry`, not a copy of the rule. Argv scenarios target `buildNodeImportArgvParts`, because `spawnNodeScript` returns a `ChildProcess`, not argv.
- **Add "Startup fails hard…" to `dashboard-server`.** Removing "Degraded-mode startup" would otherwise leave the live hard-error path (`cli.ts:252-279`) unspecified.
- **One `retire_capabilities: true` marker** covers both emptied capabilities.

## Risks / Trade-offs

- [Retiring a capability deletes its spec directory on archive; it can be recovered only from git] → the archived change keeps the REMOVED blocks with Reason/Migration. The deletion is acknowledged under Discipline Skills.
- [A rewritten scenario may lack test coverage, e.g. "other loader on win32 → URL entry", or the lint's staged-violation fixture] → test-plan.md routes each scenario to an existing test or a test-only addition.
- [Other specs may still cite the retired capabilities or deleted symbols] → tasks.md sweeps `openspec/specs/` for both. Hits outside scope go to the follow-up record.
- [Six-capability scope grows the review surface] → each capability's delta is small and validated with `--strict`.

## Migration Plan

Specs only (plus any test-only gap fills). Apply = verify + validate + archive. Rollback = `git revert` of the archive commit, which restores the deleted spec directories.
