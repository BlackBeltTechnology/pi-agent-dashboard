## Context

See proposal.md (Why) for the drift list. The audit against the code found:

- **`@mariozechner` in 13 spec files (11 besides `server-launch` and `electron-qa-coverage`)**: all mentions are correct. Each is either a negative guard ("SHALL NOT probe/contain the fork") or the deliberate `@mariozechner/jiti` loader fallback (`JITI_PACKAGES`, `packages/shared/src/platform/binary-lookup.ts:29-32`), which is a separate package from the dropped pi fork. One exception: `electron-qa-coverage` "QA simulates degraded managed-dir recovery" pins a Stage 9 (wipe `@mariozechner`, `extractedSourceIsHealthy`) that no longer exists in `test-electron-install-inner.sh`.
- **`electron-launch-source`**: the drift is wider than "Uniform spawn primitive". The Purpose, "Discriminated launch-source resolution", "Per-source probe contracts" and "Extracted self-heal…" all describe `piExtension`/`npmGlobal`/`extracted`. The code (`launch-source.ts`) has only `attach | devMonorepo | localLink | overlay | bundled`, `probeBundled` and `BundledServerMissingError`. The Electron V1 launcher is gone: `LAUNCH_SOURCE_V2` has no `packages/` hit, and `server-lifecycle.ts` has no `launchServer` export. The unrelated `launchServer()` in `packages/extension/src/bridge.ts` is out of scope. `pickNodeForServer` has no system-Node rung any more (`packages/electron/src/lib/pick-node.ts:11,32-33`). The carried-over "Uniform spawn primitive" text still claims one.
- **`bundled-recommended-extensions`**: `BUNDLED_EXTENSION_IDS` is `[]`. The bundling script, forge `extraResource`, `installBundledExtensions` and `dependency-installer.ts` are deleted. `computeIsBundled` (`packages/server/src/package/installed-package-enricher.ts:84`) still reads `<resources>/bundled-extensions/<id>`, but it is always false.
- **`server-launch` "Removed predecessors"**: the tense is wrong, and its guard grep is vacuous. `git grep -E` does not honour `\b`/`\s`, so it returns zero even though `resolveJitiImport()` still appears in `no-raw-node-import.test.ts:46`. A POSIX-class grep (`-wE … [[:space:]]*\(`) finds exactly that one comment, which task 2.4 removes.
- **`doctor-diagnostic` "Section taxonomy on every check"** (`openspec/specs/doctor-diagnostic/spec.md:21`) names the check `TypeScript loader (tsx)`. The code names it `TypeScript loader` (`packages/shared/src/doctor-core.ts:436`).
- **`electron-launch-source` CLI-wrapper requirement** (`openspec/specs/electron-launch-source/spec.md:145`) cites `probeNpmGlobal` as a live consumer. The probe is gone (`packages/server/src/__tests__/cli-version.test.ts:7`).
- **`doctor-core.ts` "TypeScript loader" row**: under jiti mode (opt-in, or forced when Node lacks type stripping) it reads managed `tsx`, resolves bundled `tsx`, and runs `which tsx`. It reports any of these as `ok`. `selectTsLoader` returns only `native|jiti`, so a tsx-only install is a false "ok". Electron Doctor delegates to this code, so the existing spec is violated in jiti mode.
- **`browser-protocol.ts`**: `BootstrapStateSnapshot`, `BootstrapStatusUpdateMessage` and `BootstrapTicketCompleteMessage` (and their two `ServerToBrowserMessage` union members) have no producer or consumer. The client comment at `useMessageHandler.ts:1939` already records their removal.
- **Stale comments**:
  - `bundle-server.mjs` (lines ~78-82 and ~209-222) says "Phase 1…", that `offline-packages.json` is still the pin source, and "~563 extracted layout (~/.pi-dashboard/…)".
  - `tool-registry/definitions.ts` (~531-537) claims tsx is a co-installed fallback loader. It also points `pi-dashboard` detection at `electron/src/lib/dependency-detector.ts`; that file still exists, so this part is not stale.
  - `no-raw-node-import.test.ts` (~46) says `resolveJitiImport()` / `resolveJitiFromAnchor()` are allowlisted by name.
  - `bundle-server.mjs:513` cites Electron's `extractBundle`.
  - `recommended-extensions.ts:624` points at `installBundledExtensions()` in the deleted `dependency-installer.ts`, and `:646` names the deleted `bundle-recommended-extensions.mjs`.
  - `doctor-core.test.ts:583` has the title "still probes for jiti/tsx", which this change makes false.
  - These comments are correctly historical and stay: `_electron-build.yml:300-306`, `test-electron-install-inner.sh:17-21` and `pi-dashboard.mjs:40-46`.
- **`electron-bundle-extract` is wholly dead.** All three requirements describe deleted code: the version-marker extraction into `~/.pi-dashboard/`, config migration on extract, and `POST /api/electron/reinstall`. `needsExtraction`, `extractBundle` and `electron/reinstall` have no hits under `packages/` (only comments in `bundle-server.mjs:513` and `test-electron-install-inner.sh:17-21`).
- **`platform-primitives` "Electron delegates to shared…"** has the scenario "Electron jiti resolver is removed" (`openspec/specs/platform-primitives/spec.md:149`). It says `resolveJitiFromPi` "(if retained) SHALL delegate to `packages/shared/src/resolve-jiti.ts`", but that file is deleted and so is the function.
- **`spawnFromSource` passes `detach: false`** (`packages/electron/src/lib/launch-source.ts:551`). The carried-over scenario says "detached".
- **Bundled-extensions drift outside `bundled-recommended-extensions`**:
  - `electron-build-pipeline` "Size budget enforcement in CI" (`openspec/specs/electron-build-pipeline/spec.md:314`) gates the removed tree;
  - `ci-cd-pipeline` scenario "tsx loader referenced by bundle script" (`openspec/specs/ci-cd-pipeline/spec.md:247`) pins the deleted `bundle-recommended-extensions.mjs` step. Both `.sh` and `.mjs` were deleted (`git log --diff-filter=D`).
- **Doctor-core leftovers beyond the probes**:
  - the error `detail` (`doctor-core.ts:~1346`) names `managedTsxPkg`, bundled tsx and PATH;
  - the comments at `:32-33` and `:1253-1256` call tsx "the legacy fallback".
- **Stale comment** at `packages/shared/src/platform/node-spawn.ts:83`: it says "Mirrors … `resolve-jiti.ts::buildJitiRegisterUrl`". The `binary-lookup.ts:362-370` notes are correctly phrased as history.
- **Doctor test seam**: `tryResolvePkg` (`doctor-core.ts:37`) resolves from the shared package. In the repo, jiti always resolves, so the "no jiti → error" path cannot be reached from a test without a seam.

## Goals / Non-Goals

**Goals:**
- After archive, no requirement in the five touched capabilities names a deleted source kind, script, function or QA stage as live.
- No Doctor surface probes or reports tsx.
- Dead protocol types and stale comments are removed or corrected.

**Non-Goals:**
- Deleting residual bundled-extension code (`BUNDLED_EXTENSION_IDS`, `computeIsBundled`, `isBundled` enrichment). User decision: spec only, code kept.
- Rewording the 11 audited `@mariozechner` capabilities. They are correct. This includes `pi-core-version-check` "Running legacy fork is flagged": it pins scope-agnostic version reading of whatever `pi` runs, not support for the fork. It also includes the `pi-core-version-check:367` negative guard that mentions the absent `bundled-extensions/` source path.
- The "Offline packages bundle" row. Its section mapping and remediation text survive (`doctor-core.ts:435,535`), but nothing produces the row. The `doctor-diagnostic` scenario is conditional ("WHEN the doctor produces…"), so it stays. Recorded only.
- Other system-Node drift: `electron-launch-source` "spawnFromSource passes bundled-Node dir…" and `server-launch` "Electron-host callers MUST supply an explicit Node binary" ("System-node case sets nodeBin") predate R3. They come from the separate system-Node rung removal (`pick-node.ts:11`) and are recorded for a follow-up. Only the requirement this change re-authors ("Uniform spawn primitive across launch sources") is corrected.
- `isBundled` requirements in `installed-package-row-enrichment` (`:89-93`) and `package-update` (`:30,53`). They are conditional on a bundled id plus an existing directory, and they still describe the live `computeIsBundled` code exactly; with an empty manifest they are vacuously false. They stay until the residual code is deleted.
- `tsx` in `server-launch` "Entry-script URL-wrapping rule" and `dashboard-server` `isTsxLoader`. These classify loader strings for argv construction, which is live code, not Doctor probing.
- The pre-existing `tsx` dependency contradiction (also `dashboard-server` `:633`, "tsx … regular dependencies"). `packaging` "tsx removed from dependencies" (`openspec/specs/packaging/spec.md:49-54`) disagrees with `packages/server/package.json:103`. Recorded for a follow-up; this change neither removes tsx nor rewrites that requirement.

## Decisions

- **REPLACE (REMOVED + ADDED) when a scenario title states removed behaviour; MODIFY otherwise.** This is the `cleanup-stale-fork-specs` precedent. `openspec validate --strict` rejects a MODIFIED block that drops a scenario, as confirmed for "Uniform spawn primitive" ("Legacy V1 launcher…"). It is therefore replaced by "Uniform spawn primitive across launch sources", which keeps every surviving scenario verbatim. "Per-source probe contracts" is replaced by "Launch-source probe contracts" (devMonorepo + bundled). "Discriminated launch-source resolution" keeps its titles and is MODIFIED.
- **Retire `electron-bundle-extract`** (REMOVED for every requirement, plus `retire_capabilities: true` in `.openspec.yaml`). This follows the `cleanup-stale-fork-specs` precedent, which retired `bootstrap-install`/`dependency-installer` for the same root cause. *Alternative:* keep the capability with a placeholder requirement. Rejected because nothing live remains to specify.
- **Correct carried-over text when re-authoring a requirement.** The ADDED "Uniform spawn primitive across launch sources" is checked against code rather than copied blindly: it drops the system-Node rung and says `detach: false`.
- **Purpose edits go directly into the main specs.** A delta's Purpose is ignored for existing capabilities, so the `electron-launch-source`, `bundled-recommended-extensions` and `electron-qa-coverage` Purposes are edited in `openspec/specs/<cap>/spec.md` during apply.
- **Drop the tsx probes rather than document them.** *Alternative:* a spec-only note that "jiti mode accepts tsx as a legacy fallback". Rejected: the server can never boot on tsx, so an "ok" row for tsx is a false positive. The remediation text `"No TypeScript loader (jiti or tsx) found…"` becomes jiti-only. The error code `doctor.ts_loader_not_found` and its i18n strings are unchanged.
- **Keep `BUNDLED_EXTENSION_IDS` specified as an empty list.** The MODIFIED manifest requirement pins `[]` (already asserted by `recommended-extensions.test.ts`) and keeps the "every bundled id is recommended" guard, so the residual code stays specified until a later deletion.
- **Add a package-resolver seam to `SharedChecksDeps`** (optional `resolvePackageJson(name)`, default `tryResolvePkg`). It is the minimum needed to test the jiti-mode error scenario; production behaviour is unchanged. *Alternative:* test only the "message does not mention tsx" branch. Rejected because it would leave the spec's error/code scenario untested.
- **Fix the vacuous guard grep in the MODIFIED "Removed predecessors"** using `-w` + `[[:space:]]`. The scenario now counts call-shaped comment mentions too. After task 2.4, the tree has none.
- **Delete the bootstrap protocol types outright.** No server sends them and no client handles them, so removing them from the `ServerToBrowserMessage` union changes no wire behaviour. Old clients never see the messages either way.

## Risks / Trade-offs

- [Dropping the tsx probe turns a tsx-only jiti-mode install from "ok" into "error"] → This is intended: such an install cannot boot. The row's remediation points at jiti.
- [A doctor test hard-codes tsx output] → Search the doctor test files for `tsx`. Only `doctor-core.test.ts:583` touches jiti mode, and it asserts only "not native"; its title is renamed in task 1.1.
- [The new `resolvePackageJson` seam diverges from production] → Its default is the existing `tryResolvePkg`, so the production call path is byte-identical.
- [Removing union members breaks an exhaustive `switch` somewhere] → `tsc` and the full test run catch it. The grep found no consumers.
- [Retiring `electron-bundle-extract` deletes its spec directory on archive; it can be recovered only from git] → The archived change keeps the REMOVED blocks with Reason/Migration.
- [Other specs cite the replaced requirement names] → No live spec (`openspec/specs/`, active change dirs) references "Uniform spawn primitive" or "Per-source probe contracts". Archived changes do, but they are immutable history.

## Migration Plan

Specs plus three small production edits. No data or config migration. Rollback: `git revert` of the change commit (spec archive and code together). This restores the retired `electron-bundle-extract` spec directory.
