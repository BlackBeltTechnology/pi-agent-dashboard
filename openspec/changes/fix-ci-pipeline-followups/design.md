## Context

See `proposal.md` — Why. Independent, small edits; the design choices are the canary's sample source, the canary's strictness, and whether the `release:` trigger goes.

- `packages/electron/scripts/verify-macos-floor.mjs` owns the `otool` exec and maps `not-extractable` / `non-numeric` → `::warning::` + `exit 0` (`:12-13`). `macos-floor.mjs` holds the pure layer: `MACOS_FLOOR_MINOS_MAJOR`, `extractMinosValues(otoolOutput)` (multi-slice safe, falls back to `LC_VERSION_MIN_MACOSX`), `checkMinosFloor` (statuses `ok`/`mismatch`/`non-numeric`/`not-extractable`).
- `.github/workflows/_electron-build.yml` runs the check post-DMG-mount on macOS legs only (`~:676-681`), guarded by a `find`-based binary lookup whose miss branch warns and passes.
- **`<electron-dir>/dist` does not exist on the macOS legs.** `electron@43.4.1`'s `package.json` has no `scripts` key; `install.js` is `bin.install-electron`. No install lifecycle downloads the prebuilt. `_electron-build.yml:156-169` re-runs it explicitly, but only `if: matrix.platform == 'linux' && matrix.arch == 'arm64'`, via `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron`. Darwin forge builds pull from the `@electron/get` cache instead. (`pnpm-workspace.yaml:66` lists `electron` under `ignoredBuiltDependencies`; that entry is vestigial for a package with no scripts.)
- `sync-release-version.yml` triggers: `release: [published, edited]` + `workflow_dispatch { correlation }`. `publish.yml` `site-redeploy` dispatches it with `--ref develop`, waits on the correlated run (`:697`), then dispatches `deploy-site.yml` separately (`:734`). `publish.yml:665` drafts every prerelease. `site-deploy-workflow-contract.test.ts` E10 asserts `deploy-site.yml` has no `release:` trigger (`/^\s*release:\s*$/m`, file-scoped, message `` `release:` trigger must not return ``) and E11 reads `sync-release-version.yml`.
- `packages/electron/vitest.build-contract.config.ts` collects the shipped-build-contract tests by explicit filename and runs in CI on ubuntu; its header mandates "config/text/fixture assertions and pure predicates only, no ambient environment". `otool` does not exist there.
- `no-hardcoded-node-modules-paths.test.ts`'s `SCAN_FILES` covers `publish.yml`, `ci.yml`, `Dockerfile.build`, and two `fix-pty-permissions.cjs` — **not** `_electron-build.yml`.
- Spec staleness is text-only; archive sync replaces the requirement blocks.

## Goals / Non-Goals

**Goals:** the tripwire cannot pass while blind on *any* axis — extractor blindness, unusable extracted value, or binary-lookup miss; every corrected statement is pinned by a test or the archive sync, or is explicitly called out as unpinnable.

**Non-Goals:** hard-failing `not-extractable` on the produced binary (option 2 — loses the documented robustness to novel shapes); automating the human-published-draft path (PAT, or stopping prerelease drafting) — larger scope, deliberately deferred; #579; correcting the `npm ci` verb in "Build tools referenced by workflows MUST be declared dependencies".

**Explicit behaviour changes** (so "no behaviour change outside the canary" is not claimed falsely): the darwin legs gain a prebuilt download; the binary-lookup miss now fails; a human-published prerelease no longer triggers a partial sync run.

## Decisions

### D1 — Make the canary's sample exist, then canary it strictly

`<electron-dir>/dist/Electron.app/Contents/MacOS/Electron` is the right sample — it is the shape we claim to understand, and the produced binary IS the renamed prebuilt — but it is absent on darwin. So:

1. **New step in `_electron-build.yml`, darwin legs, before packaging:** resolve the electron dir with `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron` and run `node install.js` there — the same three lines the `linux/arm64` leg already runs. Do not hard-code a `node_modules/electron` path; the resolver exists because hoisted-vs-nested ambiguity caused a prior crisis. Add `_electron-build.yml` to `no-hardcoded-node-modules-paths.test.ts`'s `SCAN_FILES` in the same change, since that guard does not currently reach this workflow.
2. **Canary in `verify-macos-floor.mjs`, before the produced-binary check:** run `otool -l` on the resolved prebuilt, feed the text to the new pure predicate; a verdict other than "numeric major extracted" → `::error::` naming `extractMinosValues` and the sample path, `exit 1`. A missing prebuilt is also `::error::` — a floor check without its reference binary is misconfigured, not tolerable.

**Strictness:** the canary requires a **numeric** major, not merely a non-empty array. `checkMinosFloor` maps `non-numeric` to `::warning::` + `exit 0`, so a canary satisfied by `["n/a"]` would leave the tripwire exactly as dead as a blind extractor — the hole this change exists to close.

*Alternatives rejected:* canary the `@electron/get` cache (no extra download, but couples the check to an undocumented cache layout `@electron/get` may change); canary the packaged app's `Electron Framework` binary (no download, but a second Mach-O whose shape we have never asserted — weaker reference); option 2 from the issue, hard-fail `not-extractable` on the produced binary (indistinguishable from a novel format we want to tolerate). Accepted cost: one prebuilt download per macOS leg.

**Test seam (load-bearing).** `vitest.build-contract.config.ts` is pure-only and runs on ubuntu, where `otool` is absent — so the canary's verdict logic MUST be a pure function in `macos-floor.mjs`, while the `execFileSync("otool", …)` stays in `verify-macos-floor.mjs`. The helper takes the *whole* canary situation, not just text — `{ otoolOutput, execFailed, sampleMissing }` → status — because three of the five canary verdicts (exec failure, missing sample) are not expressible as otool text, and routing them through the script's own control flow would leave them uncovered in CI. New `blind-extractor` status joins the existing `ok`/`mismatch`/`non-numeric`/`not-extractable`. Tests go in the already-collected `packages/electron/src/__tests__/macos-floor-check.test.ts` (which already reads `_electron-build.yml` and owns the `not-extractable`/`non-numeric` cases) and feed fixtures only. A canary implemented inline in the script would be untestable in CI.

**Canary failure taxonomy — all five map to `::error::` + exit 1:** blind extractor (no value), non-numeric value, missing sample file, `otool` exec failure, and (for completeness) a sample whose major mismatches the floor. The exec-failure case is deliberately asymmetric with the produced-binary path, which keeps its `::warning::` + exit 0 on exec failure (`verify-macos-floor.mjs:46`): a missing tool on the canary means the check is misconfigured, whereas a novel produced binary is the tolerated case.

### D1b — Close the lookup axis

`_electron-build.yml`'s `else echo "::warning::Main binary not found at $BIN — skipping otool check"` becomes `::error::` + `hdiutil detach` + `exit 1`. A mounted DMG whose `<App>/Contents/MacOS` holds no regular file is a packaging failure; passing the floor gate on it is the same fail-open shape D1 removes one level down.

### D2 — Remove the trigger, tell the truth about it, document both dispatches

The `release:` trigger is live for human-published prereleases and dead for pipeline releases — the inverse of what its docstring claims. It goes because the run it starts is incomplete: the workflow commits under `GITHUB_TOKEN`, and that push cannot start `deploy-site.yml` (Actions recursion suppression), which is exactly why `publish.yml` dispatches the two workflows in sequence rather than relying on the path filter.

- Test: a **new describe naming `sync-release-version.yml`** (not a silent extension of E10, whose title and assertion messages say `deploy-site.yml`) asserting no `release:` under `on:` and `workflow_dispatch.inputs.correlation` still present. The existing `/^\s*release:\s*$/m` is file-scoped block-form only; the new assertion adds inline-mapping/sequence forms (`on: {release: …}`, `on: [release]`) so a now-load-bearing SHALL NOT is not trivially evaded, and its failure message names the workflow.
- Docstring: replace the "Triggers" block with `workflow_dispatch` only, and state the full manual recovery — **dispatch `sync-release-version`, then dispatch `deploy-site`** — not a single dispatch. The workflow's existing claim that "`deploy-site.yml` picks up the change via its `paths:` filter" is false for its own `GITHUB_TOKEN` commit and is corrected in the same pass.
- The human-obligation half of the new requirement ("a hand-published draft SHALL be followed by two dispatches") is **documentation, not a testable assertion** — no test can pin a future human action. It is stated in the spec and the docstring; only the trigger's absence and the input's presence are pinned.

### D3 — Spec corrections ride the archive sync

Five requirements are re-stated as full MODIFIED blocks (see `specs/`): `ci-cd-pipeline` × 4 and `marketing-site` × 1.

The post-sync check is **scoped to the requirements this change re-states** — a blanket `rg "npm ci" openspec/specs/ci-cd-pipeline/spec.md` is unsatisfiable and always was: the string legitimately survives in the "Build tools…" requirement (out of scope, stale verb only) and in the `marketing-site` "no site-scoped install" SHALL NOT, where `npm ci` names a forbidden command. Likewise `Astro` survives at `marketing-site/spec.md:408` — inside the **Performance and accessibility budgets** requirement, *not* the `## Purpose` preamble (which is lines 3-5 and contains no "Astro") — as a deliberate historical note explaining why the JS-size budget was deleted. Both are left; the verification greps name the specific requirement blocks, not the files.

**Scenario titles are preserved verbatim** in every MODIFIED block. `openspec archive` refuses a sync that drops a scenario the current spec still has, and a retitled scenario reads as a drop — so bodies are corrected in place under their existing headings (this bit once already: the `marketing-site` token scenario keeps its "Pi blue" title despite the body no longer mentioning Tailwind).

### D4 — Docstring fix is comment-only

`spa404Fallback` comment says: Pages serves the repo-root `site/404.html` for any unmatched path, including under `/app/`; the copied `404.html` in the shell's dist is reached only if the shell is ever deployed at a root; hash routing keeps deep links off the server.

### D5 — Re-state the marketing-site token scenario against the real tokens

The current scenario asserts Tailwind `pi-*` colours resolving through `rgb(var(--pi-xxx) / <alpha-value>)`, declared in `:root` and `:root.dark`, covering `surface`/`surface-alt`/`muted`/`accent2`/`success`/`warn`. None of that is true post-`c52745af0` — `site/` contains zero `--pi-`, zero `rgb(var(`, zero `root.dark`, and none of those semantic names. The tree (`site/index.html:64-95`, `site/404.html:79`) declares literal hex tokens in `:root` — `--bg-primary|secondary|tertiary`, `--text-primary|secondary|tertiary`, `--accent|accent-solid|accent-text`, `--status-idle|working|needs-you`, `--border` — "lifted verbatim from `packages/client/src/index.css`", with light mode overriding them under `[data-theme="light"]`. The scenario body is re-stated to assert *that* contract (site and product share one token vocabulary; both themes declare a complete set), which is the property worth pinning.

### D6 — Correct the enforcement-point count

The `electron-build-pipeline` requirement prose says the floor is "enforced at three independent points". With the prebuilt canary it is four (declared intent, compiler contract, produced-binary verification, extractor canary). A faithful restatement must not carry a count this change falsifies.

## Risks / Trade-offs

- [The new darwin `node install.js` step adds a prebuilt download (~100 MB) to each macOS leg] → accepted; it is the same step the `linux/arm64` leg already pays, and it makes the reference binary a build input rather than an assumption.
- [`node install.js` could fail on a runner with a cold/blocked network, reddening macOS legs that previously passed] → it fails loudly at install time with an electron-owned error, which is strictly better than the floor check silently degrading.
- [Removing `release:` loses the automatic half-path for human-published prereleases] → replaced by a documented two-dispatch recovery; the half-path never deployed the site anyway, so nothing that previously worked stops working. The obligation is unenforceable by test — accepted and stated, not hidden.
- [Hardening the binary-lookup branch could red a leg that today warns through] → intended; a DMG with no inner binary is not shippable.
- [The canary proves the extractor on a single-arch prebuilt, so multi-slice blindness stays unproven by it] → out of scope here; multi-slice safety is already pinned by `extractMinosValues`'s own L1 fixtures in `macos-floor-check.test.ts`.
