# Design

## Context

See proposal.md (Why). The behaviour this design relies on, cited from pi 1.5.0 (`node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js`):

- `resolve()` puts project `packages` ahead of global ones (`:731-742`, comment "project first so cwd resources win collisions").
- `applyPackageFilter()` with an empty pattern array adds every manifest file with `enabled=false` (`:2017-2024`, "Empty array explicitly disables all resources of this type").
- `addResource()` keeps the first entry per absolute file path and ignores later ones (`:2216-2222`).
- `applyPatterns()` with only `+` patterns starts from all manifest files (`:575-600`). A `+path` can only re-enable a file that is already in `allPaths`, so it can never add a file from outside the root manifest.
- Root `package.json` `pi.extensions` = `["packages/extension/src/bridge.ts"]`. `packages/extension/package.json` `pi.extensions` = `["src/bridge.ts"]`, which is the same absolute file.

Current script (`.pi/skills/switch-extension-source/scripts/switch-source.ts`):
- `purge()` (`:88-99`) filters `ov.extensions` but never removes the entry.
- `ensureProjectOverlay()` (`:126-135`) matches and writes `source: REPO`, which is absolute (`:34`).
- `writeJson()` (`:44-48`) calls `copyFileSync` unconditionally, and `cmdSwitch` writes PROJECT whenever `mode === "local"`, even if the file is missing (`:159`).
- `cmdStatus` and `cmdSwitch` read GLOBAL unconditionally (`:114`, `:140`). A missing global file fails fast, which is kept.
- `resolvePkg` calls `process.exit` on an unknown package (`:73-81`).
- The module dispatches on `process.argv` at import time (`:165-173`), so nothing can be imported for a test.
- Committed `HEAD:.pi/settings.json` holds `{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"] }`. By the `applyPatterns` rule this entry enables nothing extra. The maintainer's uncommitted working-tree edit removes it.

The repo check `scripts/check-pi-settings-paths.mjs` exports a pure `absoluteSourceViolations(file, raw)` (`:52-73`), runs `main()` only when executed directly (`:105-107`), and runs in CI (`.github/workflows/ci.yml:158`). Its tests are in `scripts/__tests__/check-pi-settings-paths.test.mjs`, collected by the root `scripts` vitest project.

## Goals / Non-Goals

**Goals:**
- The script can never write an empty resource-filter array.
- The script's pure logic is unit-testable without touching the real `~/.pi` or repo settings.
- CI catches a committed empty filter regardless of who wrote it.

**Non-Goals:**
- Changing pi's resolver or reporting its first-wins-by-path behaviour upstream.
- Touching the addons all-empty disable (`packages/server/src/addons/settings-entries.ts:56`). It is deliberate and writes only to global settings.
- Cleaning up the user's existing `.pi/settings.json` (including `HEAD`'s inert `+kb` entry, which the maintainer's pending commit removes) or old `*.bak-switch-*` files.
- Extending the check beyond `CHECKED_FILES = [".pi/settings.json"]` (`check-pi-settings-paths.mjs:35`). Other committed fixture settings have no `packages` today.
- Stripping `-`/`!` patterns for a package. The tool only ever wrote `+` paths.

## Decisions

**D1: Prune rule: repair repo-root and touched entries, leave the rest alone.**
An entry is a repair candidate when it is an object, `autoload !== false`, and either:
- `purge` removed a `+packages/<dir>/` path from it in this run, or
- its `source` is a string that resolves to the repo root. `purge` takes the project settings path: `resolve(dirname(projectPath), source) === dirname(dirname(projectPath))`, so `".."` qualifies, and injected test paths work without the `REPO` constant.

Repair deletes each of `extensions/skills/prompts/themes` whose array is empty. If the entry had at least one of those keys before repair and has none after, it is spliced out (never collapsed). An entry such as `{source:".."}` with no keys is left alone. Afterwards `packages` is deleted whenever it is an empty array.

This deliberately departs from the original request ("drop the entry once its extensions list is empty") in one case: an entry that still has a non-empty `skills/prompts/themes` key is kept with `extensions` removed. Dropping it would also discard filters the user wrote for other resource types.
- Why the repo root: an empty array "explicitly disables all resources of this type" (`package-manager.js:2017-2024`), which is a legitimate project-scope disable for an ordinary package (`{source:"npm:foo", extensions:[]}`). It only harms when the package shares files with another package. In this repo that is exactly the root package: root `pi.extensions` and `pi.skills` point into `packages/extension`, which global settings load. So other-package entries are left alone.
- Why all four keys on the root: root `pi.skills` (`packages/extension/.pi/skills/pi-dashboard`) overlaps the same way `bridge.ts` does.
- Why the touched rule: an entry the tool just emptied must not be left as a disable it never meant to write.
- The incident's residue `{source:"..", extensions:[]}` is repaired by the root rule even though nothing is purged from it.
- Same idea as `resource-activation-toggle.ts:487-503` (delete an emptied key, splice an emptied delta). That code works on deltas; this rule works on full filter entries.
- Rejected alternative: repair every empty non-delta entry. That silently re-enables a deliberate disable of another package.
- Rejected alternative: prune only entries whose length changed in this purge. That never repairs the existing residue.
- Rejected alternative: collapse the entry to a bare `".."` string. That loads the whole root package at project scope, which is a new declaration nobody asked for.

**D2: Remove `--overlay` instead of fixing it.**
- Because of the `applyPatterns` rule above, the overlay can only toggle `bridge.ts`, which the global entry already loads.
- A "fixed" overlay would be a feature with zero working targets.
- `ensureProjectOverlay` and the overlay branch are deleted. `--overlay` exits 1 with a pointer to plain `local`, before any read or write.
- `detect()` keeps reporting `local (project overlay)` so `status` still shows old entries that `purge()` will clean up.

**D3: Make the script testable the same way the check script is.**
- Export `purge`, `detect` and `cmdSwitch`. `cmdSwitch` gains an optional last parameter `paths = { global: GLOBAL, project: PROJECT, pkgs: PKGS }`, and `scanPackages` takes the `pkgs` dir. The defaults keep CLI behaviour identical.
- Tests call `purge`/`detect` with in-memory objects, and call `cmdSwitch` with temp-dir paths, so no real `~/.pi` or repo file is touched.
- Tests stub `process.exit` to throw, because `resolvePkg` and the `--overlay` rejection exit.
- Run the CLI only when `process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))`, copied exactly from `check-pi-settings-paths.mjs:105`.
- Malformed entries:
  - Project entries that are not objects are skipped by `purge` and `detect`. Today `null` throws on `ov.extensions`; bare strings happen not to.
  - A non-array `extensions` is left alone.
  - Global entries are matched by `typeof e === "string" ? e : e?.source`, because the toggle keeps object entries at global scope (`resource-activation-toggle.ts:502`). Today `e.startsWith` throws on them (`switch-source.ts:91`, `:106`).
- `--overlay` is rejected at the top of `cmdSwitch` (before any read), so tests reach it through the exported function with `process.exit` stubbed.
- The project file is written only when its serialized JSON changed, so a no-op switch creates no project backup.
- Rejected alternative: a new pure `planSwitch`. It is an abstraction nobody asked for.
- Rejected alternative: a subprocess test against a temp repo copy. It is slower, and it still depends on `homedir()`.

**D4: Add the empty-filter rule to `check-pi-settings-paths.mjs`; no new script.**
- Add an exported `emptyFilterViolations(file, raw)` that returns `[]` on a parse failure; `absoluteSourceViolations` keeps owning the single parse-error finding.
- `main()` combines both lists. Every violation carries a `kind`:
  - `absolute` and `parse` are set on the existing `absoluteSourceViolations` results.
  - `empty-filter` is set on the new ones.
- `CORRECTION` and the trailing `pi install` note (`check-pi-settings-paths.mjs:97-101`) print only when some violation has `kind: "absolute"`. Empty-filter hits print "remove the empty key or the entry".
- An entry fails when it is an object, `autoload !== false`, and any of `extensions/skills/prompts/themes` is an array of length 0.
- `autoload:false` deltas are exempt: an empty array in a delta is a no-op (`applyPackageDeltaFilter` returns early on `[]`).
- Rejected alternative: a separate script. It would mean a new CI step for the same file.
- The check is stricter than the tool on purpose. The committed `.pi/settings.json` is shared by every contributor, so a deliberate disable there must use the `autoload: false` delta form (the form the dashboard toggle writes, `resource-activation-toggle.ts:482`), which pi treats as a no-op on `[]`. The tool leaves a local `{source:"npm:foo", extensions:[]}` alone, and the check rejects it only if it is committed.

**D5: Write the project file only when it exists.**
- `cmdSwitch` writes PROJECT only if it exists. After D2, the script never creates project settings.
- `writeJson` is unchanged: its unconditional backup stays as a fail-safe.

**D6: Test home.**
- A new vitest project config at `.pi/skills/switch-extension-source/vitest.config.ts` with tests in `scripts/__tests__/`, registered in the root `vitest.config.ts` next to `.pi/skills/ship-it` (`vitest.config.ts:163-165`).
- Guard tests extend `scripts/__tests__/check-pi-settings-paths.test.mjs`.

## Risks / Trade-offs

- [Someone relies on `--overlay`] → It never loaded anything new (see Context), and it exits loudly with the replacement command.
- [Repair deletes a user-written empty filter on the repo-root entry] → Such an entry disables the dashboard bridge or skills for every session in the repo, which is never intended. A backup is written first, and the behaviour is in the spec.
- [The guard fires on today's working tree] → Checked: the hand-edited `.pi/settings.json` has no `packages` key, and committed `HEAD` holds a non-empty `+kb` filter. Both pass.
- [A future pi version changes the resolver] → The rule (no empty arrays outside deltas) is safe under any pi version, because the guard can only be stricter than needed, never looser.

## Migration Plan

- None for distribution users.
- Developers with a leftover `{"source":"..","extensions":[]}` are cleaned up by the next `local` or `npm` switch of that package. The guard flags it if it is ever committed.
- Rollback = revert the commit.
