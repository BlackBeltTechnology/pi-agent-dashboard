Test tasks below are folded from `test-plan.md`; each carries its scenario Triple and manifest id.
Harness exemplars: L1 server → `packages/server/src/__tests__/resource-activation-toggle.test.ts`;
L1 routes → `resource-activation-routes.test.ts`; L1 scanner → `pi-resource-scanner.test.ts`;
L1 client → `packages/client/src/lib/__tests__/resources-api.test.ts`;
L3 → `tests/e2e/openspec-artifact-dialog.spec.ts` (harness port from `.pi-test-harness.json#dashboardPort`).

## 1. Origin classification

- [ ] 1.1 Test: cwd == $HOME nesting · a skill at `~/.pi/agent/skills/foo/SKILL.md` with `<cwd>/.pi` an ancestor of `~/.pi/agent` · classify at local scope · origin is `global-loose`, not `project-loose`; see resource-activation-toggle.test.ts (test-plan #E1)
- [ ] 1.2 Test: classification stable post-mutation · a disabled global skill pi now reports as `scope: project, source: local, baseDir: undefined` · classify for re-enable · origin identical to the pre-disable classification; see resource-activation-toggle.test.ts (test-plan #E2)
- [ ] 1.3 Test: npm root under the global base · a package at `~/.pi/agent/npm/node_modules/probe/skills/a/SKILL.md` · classify at local scope · origin is `package`, not `global-loose`; see resource-activation-toggle.test.ts (test-plan #E3)
- [ ] 1.4 Test: symlinked resource · a global skill whose real path resolves inside the checkout · classify at local scope · classification and lookup agree and the written entry disables it; see resource-activation-toggle.test.ts (test-plan #E4)
- [ ] 1.5 Implement `classifyResourceOrigin` by longest-prefix on the resolved path, never on `metadata.scope`/`source`/`baseDir`; resolve package roots against the user scope; make 1.1–1.4 pass

## 2. Write forms per origin

- [ ] 2.1 Test: project-loose · `<cwd>/.pi/skills/local-demo/SKILL.md` · disable at local · `skills` gains `-skills/local-demo/SKILL.md`, `packages` untouched; see resource-activation-toggle.test.ts (test-plan #E5)
- [ ] 2.2 Test: `.agents` base dir · a skill based at `<ancestor>/.agents` · disable at local · force-exclude relative to that base; resolver reports disabled; see resource-activation-toggle.test.ts (test-plan #E6)
- [ ] 2.3 Test: global-loose directory-shaped · `~/.pi/agent/skills/foo/SKILL.md` · disable at local · `skills` gains that file path in tilde form plus an anchored exclusion; global settings untouched; resolver reports disabled; see resource-activation-toggle.test.ts (test-plan #E7)
- [ ] 2.4 Test: global-loose flat file · a bare `.md` skill directly under `~/.pi/agent/skills` · disable at local · entry is that file not the root; every sibling stays enabled at user scope; see resource-activation-toggle.test.ts (test-plan #E8)
- [ ] 2.5 Test: global prompt · a global prompt, always flat in a shared root · disable at local · resolver reports it disabled, other prompts enabled; see resource-activation-toggle.test.ts (test-plan #E9)
- [ ] 2.6 Test: global theme · a global theme, always flat in a shared root · disable at local · resolver reports it disabled, other themes enabled; see resource-activation-toggle.test.ts (test-plan #E10)
- [ ] 2.7 Test: portability across homes · a settings file produced under `$HOME=A` · resolve under `$HOME=B` where the equivalent skill exists · resolver reports disabled and no entry holds a machine-specific absolute path; see resource-activation-toggle.test.ts (test-plan #E11)
- [ ] 2.8 Test: unsupported agent-dir layout · an agent directory outside the home directory · disable a global-loose resource under it · rejected with an error naming the layout; nothing written; see resource-activation-toggle.test.ts (test-plan #E12)
- [ ] 2.9 Implement the four write forms, deriving the anchor from the configured agent directory; make 2.1–2.8 pass

## 3. Package handling

- [ ] 3.1 Test: project-scope delta · `npm:probe-pkg` declared only globally contributing `alpha` and `beta` · disable `beta` at local · `packages` gains `{source, autoload:false, skills:["-skills/beta/SKILL.md"]}` and the call is not a 404; see resource-activation-toggle.test.ts (test-plan #E13)
- [ ] 3.2 Test: the flag is load-bearing · the same delta written without `autoload:false` · resolve · the package contributes nothing, proving why the flag is mandatory; see resource-activation-toggle.test.ts (test-plan #E14)
- [ ] 3.3 Test: global scope keeps in-place mutation · global `packages` holds the bare string `"npm:probe-pkg"` · disable `beta` at global · entry mutated in place to object form with a plain filter, no `autoload`, no second entry, `beta` disabled and `alpha` enabled; see resource-activation-toggle.test.ts (test-plan #E15)
- [ ] 3.4 Test: sibling isolation · the delta from 3.1 · resolve · `alpha` enabled and `beta` disabled; see resource-activation-toggle.test.ts (test-plan #E16)
- [ ] 3.5 Test: no project install · the delta from 3.1 for an npm source installed under the user agent dir · resolve · no project-scope package directory created; see resource-activation-toggle.test.ts (test-plan #E17)
- [ ] 3.6 Test: npm identity normalisation · project holds `{source:"npm:foo@^1.0.0", skills:["+skills/alpha/SKILL.md"]}` · disable a skill from `npm:foo@^2.0.0` at local · existing entry extended, `+` filter preserved, no duplicate; see resource-activation-toggle.test.ts (test-plan #E18)
- [ ] 3.7 Test: git identity normalisation · project declares a package by SSH URL, globally declared by HTTPS · disable a resource from it at local · recognised as one package, no duplicate entry; see resource-activation-toggle.test.ts (test-plan #E19)
- [ ] 3.8 Test: project-owned entry preserved · project holds `{source:"<repo>", extensions:["+packages/kb-extension/src/index.ts"]}` · disable a skill from `<repo>` at local · entry gains the skill exclusion, keeps its extensions filter, does not gain `autoload:false`; see resource-activation-toggle.test.ts (test-plan #E20)
- [ ] 3.9 Implement the delta writer, the global-scope in-place branch, and identity matching; make 3.1–3.8 pass

## 4. Re-enable and ownership

- [ ] 4.1 Test: round trip per origin · a settings file in a known state, each of the four origins · disable then re-enable · resolver reports the same enabled flag for every resource as before; see resource-activation-toggle.test.ts (test-plan #E21)
- [ ] 4.2 Test: no force-include written · any disabled resource · re-enable · no `+` entry exists for it afterwards; see resource-activation-toggle.test.ts (test-plan #E22)
- [ ] 4.3 Test: owned pair removed · a global skill disabled by this dashboard with an ownership record · re-enable · file entry and exclusion both removed, original global scope restored, record cleared; see resource-activation-toggle.test.ts (test-plan #E23)
- [ ] 4.4 Test: partial delta survives · a delta excluding one skill and one extension · re-enable the skill · skill exclusion removed, entry survives with the extension exclusion, that extension stays disabled; see resource-activation-toggle.test.ts (test-plan #E24)
- [ ] 4.5 Test: user-authored entry survives · a project `skills` array holding a user-authored plain entry with no ownership record · disable then re-enable · the dashboard's exclusion removed, the user's plain entry remains, resource enabled; see resource-activation-toggle.test.ts (test-plan #E25)
- [ ] 4.6 Test: dashboard-authored entry removed · a global resource disabled through the dashboard with an ownership record · re-enable · plain entry and exclusion removed, record cleared; see resource-activation-toggle.test.ts (test-plan #E26)
- [ ] 4.7 Test: settings file stays pi-standard · any completed toggle · inspect `<cwd>/.pi/settings.json` · it holds only keys pi itself interprets; see resource-activation-toggle.test.ts (test-plan #E27)
- [ ] 4.8 Test: one settings write per toggle · any completed toggle · count settings-file writes · exactly one, with the ownership record written separately; see resource-activation-toggle.test.ts (test-plan #E28)
- [ ] 4.9 Implement the per-project ownership store under `~/.pi/dashboard/`, modelled on `packages/server/src/git-worktree/worktree-init-trust.ts` (atomic tmp+rename); make 4.1–4.8 pass

## 5. Stripping, guard, ambiguity

- [ ] 5.1 Test: stale differently-spelled exclusion · project `skills` holds `-skills/foo` from pi's config selector · enable `skills/foo/SKILL.md` · stale entry removed, resource enabled; see resource-activation-toggle.test.ts (test-plan #E29)
- [ ] 5.2 Test: force-include never stripped · project `skills` holds `!skills/foo/SKILL.md` and `+skills/foo/SKILL.md` so the resource is enabled · disable then re-enable · the `+` entry still present and the resource still enabled; see resource-activation-toggle.test.ts (test-plan #E30)
- [ ] 5.3 Test: user's broad glob preserved · project `skills` holds a user-authored `!skills/**` · toggle one resource it covers · the glob remains and the other covered resources stay disabled; see resource-activation-toggle.test.ts (test-plan #E31)
- [ ] 5.4 Test: guard rejects the wrong direction · `{scope:"global", cwd, type:"skill", filePath:"<cwd>/.pi/skills/local-demo/SKILL.md"}` · submit · `400` naming the scope mismatch, not `404`; neither settings file written; see resource-activation-routes.test.ts (test-plan #E32)
- [ ] 5.5 Test: guard permits the supported direction · a global skill · toggle at local scope · not rejected by the guard; see resource-activation-toggle.test.ts (test-plan #E33)
- [ ] 5.6 Test: ambiguous relative path escalates · `<cwd>/.pi/skills/shared/SKILL.md` and `<ancestor>/.agents/skills/shared/SKILL.md` identical relative to their bases · disable one at local · an exclusion anchored on that resource's base leaf, containing no home or checkout path, no re-declaration, the other skill still enabled; see resource-activation-toggle.test.ts (test-plan #E34)
- [ ] 5.7 Implement exact-spelling stripping (never evaluating a user glob, never touching `+`), the directional guard, and ambiguity escalation; make 5.1–5.6 pass

## 6. Trust gate

- [ ] 6.1 Test: recorded trust proceeds · a cwd with a recorded trusted decision · toggle at local · applied directly with no prompt; see resource-activation-routes.test.ts (test-plan #E35)
- [ ] 6.2 Test: recorded refusal blocks · a cwd with a recorded refusal · toggle at local · refused with an explanatory error, nothing written; see resource-activation-routes.test.ts (test-plan #E36)
- [ ] 6.3 Test: defaults decide · a cwd with no recorded decision, under each `defaultProjectTrust` value · toggle at local · `always` proceeds without recording, `never` refused with no prompt, `ask` returns `trust_required`; see resource-activation-routes.test.ts (test-plan #E37)
- [ ] 6.4 Test: implicitly-trusted folder still prompts · a cwd with no `.pi` directory, default `ask` · toggle at local · a prompt is returned rather than silently proceeding; see resource-activation-routes.test.ts (test-plan #E38)
- [ ] 6.5 Test: catch-22 regression · the 6.4 folder after trust is approved and the toggle applied · resolve as a newly-started headless session · the resource is reported disabled, so the write survives the folder becoming trust-requiring; see resource-activation-toggle.test.ts (test-plan #E39)
- [ ] 6.6 Test: trust write fails · `ProjectTrustStore.set` throws after approval · approval submitted · the toggle is refused and the trust-write failure surfaced, no settings written; see resource-activation-routes.test.ts (test-plan #X2)
- [ ] 6.7 Implement the trust gate, the `trust_required` response with dashboard-authored options (trust folder / trust parent / decline), and the persist-and-retry endpoint; route every write through a single choke point that cannot be reached without the gate; make 6.1–6.6 pass

## 7. Concurrency and error handling

- [ ] 7.1 Test: two rapid toggles both survive · a folder with two enabled resources · disable both without awaiting the first response · settings holds both entries and resolver reports both disabled; see resource-activation-routes.test.ts (test-plan #E40)
- [ ] 7.2 Test: unparseable settings fails loudly · `<cwd>/.pi/settings.json` unparseable so pi silently skips the write · any toggle · an error identifying the file, not a success; see resource-activation-toggle.test.ts (test-plan #X1)
- [ ] 7.3 Test: external writer clobber is bounded · another process rewrites the same array between construction and flush · toggle completes · documented last-writer-wins holds, loss confined to that array, file not corrupted; see resource-activation-toggle.test.ts (test-plan #X3)
- [ ] 7.4 Test: resolver failure writes nothing · pi's `PackageManager.resolve()` throws · any toggle · the toggle fails with an error, no settings written, no partial entry; see resource-activation-toggle.test.ts (test-plan #X4)
- [ ] 7.5 Ensure the settings manager is constructed and flushed inside the per-file write lock; make 7.1–7.4 pass

## 8. Performance

- [ ] 8.1 Test: toggle latency · a workspace with this repo's resource count, one `applyResourceToggle` per iteration · 50 iterations · p95 under 1s per toggle; see resource-activation-toggle.test.ts (test-plan #P1)
- [ ] 8.2 Test: no settings accretion · the same resource disabled and re-enabled 100 times · 100 cycles · the settings array returns to its starting length each cycle; see resource-activation-toggle.test.ts (test-plan #P2)

## 9. Client surface

- [ ] 9.1 Test: trust dialog blocks convergence · folder Resources surface for a folder with no recorded decision · user disables a resource · a dialog presents the options and the control has not converged to disabled; see tests/e2e/openspec-artifact-dialog.spec.ts (test-plan #F1)
- [ ] 9.2 Test: dismissal reverts · the trust dialog open · user dismisses without choosing · control converges back and no settings or trust file is written; see tests/e2e/openspec-artifact-dialog.spec.ts (test-plan #F2)
- [ ] 9.3 Test: failures surface · a toggle the server rejects with a message · response received · control reverts and the message is presented, with a request that never reached the server reported distinctly; see tests/e2e/openspec-artifact-dialog.spec.ts (test-plan #F3)
- [ ] 9.4 Test: row stays where acted on · a global resource in the global section of the folder surface · disable then re-enable · after disable the row stays put and indicates the folder controls activation, after re-enable the original grouping returns; see tests/e2e/openspec-artifact-dialog.spec.ts (test-plan #F4)
- [ ] 9.5 Test: repository-wide notice · the folder Resources surface · user disables a resource · the surface states the change is written to the tracked `.pi/settings.json` and shared, and that each toggle produces a whole-file diff; see tests/e2e/openspec-artifact-dialog.spec.ts (test-plan #F5)
- [ ] 9.6 Implement error surfacing in `useResourceActivation`, the trust dialog, the scope-flip presentation, and the repository-scope notice; make 9.1–9.5 pass
- [ ] 9.7 `npm run build && curl -X POST http://localhost:8000/api/restart`; verify in all four themes

## 10. Manual verification

- [ ] 10.1 Read the trust dialog alongside pi's own trust prompt and confirm the wording is recognisably equivalent and does not imply a different security decision (test-plan: manual-only)

## 11. End-to-end validation

- [ ] 11.1 Reproduce the original defect: disable `image-to-3d-threejs` at folder scope, refresh, confirm it stays off
- [ ] 11.2 Confirm a second folder on the same machine still reports it enabled
- [ ] 11.3 Confirm a newly started terminal session in the folder treats it as disabled, with no dashboard involvement
- [ ] 11.4 Confirm pi's own `/config` agrees with the dashboard for every origin
- [ ] 11.5 Disable a `context-mode` skill and confirm its other seven skills remain available
- [ ] 11.6 Confirm a git worktree of the same branch inherits the disable
- [ ] 11.7 Confirm this repo's `kb-extension` project package entry is intact after exercising a package disable against the repo source

## 12. Discipline passes

- [ ] 12.1 `doubt-driven-review` on the trust gate and the write choke point before they stand
- [ ] 12.2 `security-hardening` on the trust boundary, including that `defaultProjectTrust: always` deliberately does not record
- [ ] 12.3 `review-code` over the full diff before commit

## 13. Documentation

- [ ] 13.1 Correct the false JSONC-preserving claim in `packages/server/src/pi/resource-activation-toggle.ts`'s header and in `docs/architecture.md`; pi's write is a whole-file `JSON.parse`/`JSON.stringify` round trip that discards comments
- [ ] 13.2 Delegate to `DocScribe`: document the four project-scope forms and the origin classification in `docs/architecture.md`
- [ ] 13.3 Delegate to `DocScribe`: add a `docs/faq.md` entry for "I disabled a global skill for this project and it came back"
- [ ] 13.4 Document that tightening `defaultProjectTrust` after disables were written while it was `always` stops those disables applying until the folder is trusted explicitly
- [ ] 13.5 Extend the `bump-pi-version` checklist to cover pattern-matching semantics and package-identity normalisation, not only directory layout
- [ ] 13.6 Update the nearest directory `AGENTS.md` rows for every file touched, with `See change: project-scope-disable-global-resources`
