## 1. Origin classification

- [ ] 1.1 Write failing unit tests for `classifyResourceOrigin({scope, cwd, item})` returning `same-scope-loose` / `package` / `cross-scope-loose` / `invalid`, covering: project resource at local scope; global resource at local scope; project resource at global scope (invalid); package resource declared in the target scope; package resource declared only in the other scope
- [ ] 1.2 Implement the classifier in `packages/server/src/pi/` and make 1.1 pass
- [ ] 1.3 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm nothing regressed

## 2. Write path — same-scope and rejection

- [ ] 2.1 Write a failing test asserting a global-scope toggle of a project resource is rejected `400` and writes nothing
- [ ] 2.2 Write a failing test asserting the scope-containment guard evaluates against the **scope-derived** base directory — the current guard derives it from `item.metadata.baseDir` and is tautological
- [ ] 2.3 Repair the guard and make 2.1–2.2 pass
- [ ] 2.4 Confirm every pre-existing same-scope scenario in `resource-activation-routes.test.ts` still passes byte-for-byte unchanged

## 3. Write path — package delta

- [ ] 3.1 Write a failing test asserting a package declared only globally, disabled at local scope, produces `{ source, autoload: false, <type>: ["-<rel to package root>"] }` in the project's `packages` array and returns success rather than `404`
- [ ] 3.2 Write a failing test asserting the `autoload: false` flag is present — omitting it makes pi drop the package's entire contribution
- [ ] 3.3 Write a failing test asserting sibling resources from the same package remain enabled after the disable
- [ ] 3.4 Write a failing test asserting an `npm:` source resolves from its existing user install and no project-scope package directory is created
- [ ] 3.5 Write a failing test asserting a second disable from the same package extends the existing delta rather than adding a second entry
- [ ] 3.6 Write a failing test asserting an existing **project-owned** package entry (this repo's `{ source: "<repo>", extensions: ["+packages/kb-extension/src/index.ts"] }`) is extended in place, keeps its existing filter, and does not gain `autoload: false`
- [ ] 3.7 Implement the package-delta writer and make 3.1–3.6 pass

## 4. Write path — cross-scope loose

- [ ] 4.1 Write a failing test asserting a global loose skill disabled at local scope adds both the containing directory entry and an absolute force-exclude to the project's array
- [ ] 4.2 Write a failing test asserting a force-exclude is never written without the directory entry — alone it is inert
- [ ] 4.3 Write a failing test asserting sibling resources in the same global directory stay enabled
- [ ] 4.4 Write a failing test asserting each resource in a re-declared directory appears exactly once in the resolved set
- [ ] 4.5 Write failing tests covering all three global loose locations: `~/.pi/agent/skills`, `~/.agents/skills`, `~/.pi/agent/extensions`
- [ ] 4.6 Implement the cross-scope-loose writer and make 4.1–4.5 pass

## 5. Re-enable and cleanup

- [ ] 5.1 Write a failing round-trip test asserting disable-then-enable restores the settings file to an equivalent state, for each of the three origins
- [ ] 5.2 Write a failing test asserting the directory re-declaration is removed together with the last force-exclude for that directory
- [ ] 5.3 Write a failing test asserting the directory entry survives while other force-excludes for it remain
- [ ] 5.4 Write a failing test asserting a directory entry the user authored before any dashboard toggle is preserved on re-enable
- [ ] 5.5 Write a failing test asserting an emptied package delta entry is removed from the `packages` array
- [ ] 5.6 Implement the reversal logic and make 5.1–5.5 pass

## 6. Client surface

- [ ] 6.1 Write a failing test asserting `useResourceActivation` surfaces the server's error message on a rejected toggle, in addition to reverting
- [ ] 6.2 Write a failing test asserting a thrown request is reported as not having reached the server, distinctly from a rejection
- [ ] 6.3 Implement the failure surfacing and make 6.1–6.2 pass
- [ ] 6.4 Handle the scope flip: a resource disabled via re-declaration reports `scope: project` / `source: local`, so keep the row in the section the user acted in and indicate the folder now controls its activation
- [ ] 6.5 Write a test asserting re-enabling restores the original grouping
- [ ] 6.6 Add the repository-wide scope notice to the folder Resources surface
- [ ] 6.7 Run `npm run build && curl -X POST http://localhost:8000/api/restart` and verify the surface in all four themes

## 7. End-to-end validation

- [ ] 7.1 Reproduce the original defect: disable `image-to-3d-threejs` at folder scope, refresh, confirm it stays off
- [ ] 7.2 Confirm a second folder on the same machine still reports it enabled
- [ ] 7.3 Confirm a **terminal-started** session in the folder also treats it as disabled — pi enforces this, no dashboard involvement
- [ ] 7.4 Confirm pi's own `/config` agrees with the dashboard for all three origins
- [ ] 7.5 Disable a `context-mode` skill (npm package, globally declared) and confirm the package's other seven skills remain available
- [ ] 7.6 Confirm a git worktree of the same branch inherits the disable
- [ ] 7.7 Confirm this repo's `kb-extension` project package entry is intact after exercising a package disable against the repo source

## 8. Discipline passes

- [ ] 8.1 `doubt-driven-review` on the three-branch write path, focused on the silent-and-total failure mode of a delta missing `autoload: false`
- [ ] 8.2 `security-hardening` on the trust boundary — confirm this change adds no path around pi's existing project-trust gate
- [ ] 8.3 `review-code` over the full diff before commit

## 9. Documentation

- [ ] 9.1 Delegate to `DocScribe`: document the three pi-standard project-scope forms and the origin classification in `docs/architecture.md`
- [ ] 9.2 Delegate to `DocScribe`: add a `docs/faq.md` entry for "I disabled a global skill for this project and it came back"
- [ ] 9.3 Update the nearest directory `AGENTS.md` rows for every file touched, with `See change: project-scope-disable-global-resources`

## 10. Open questions to resolve before archiving

- [ ] 10.1 Decide whether the toggle should proactively clean inert legacy entries left by the previous buggy write path, or leave them alone
- [ ] 10.2 Confirm which entry a project-scope toggle extends when a package is declared in both global and project settings, for every source type
- [ ] 10.3 Decide whether the Resources view needs a bulk "reset this folder's activation overrides" action
