# check-plugin-boundary.mjs — index

Plugin/core boundary gate, run by `ship-it` step 4.4, `npm run check:plugin-boundary`, and the `scripts` vitest project. Core → plugin and plugin → plugin edges fail unless a row in `plugin-boundary-allowlist.json` covers `(from, to)`.
- Plugin set = `packages/*` with `package.json#pi-dashboard-plugin` or `dashboard-plugin.json`. Never a name pattern. Core = every other `packages/*`.
- Scanners split per source: ts (`ts.preProcessFile` + `vi|jest.(do)?mock|importActual` literal + template `import(\`…\`)` regex, comments skipped), `package.json` (4 dep fields), CSS `@source`.
- Kinds: `prod`, `test` (test dirs, `*.test.*`, vitest setup files), `pkg`, `css`, `host` (plugin non-test source importing `dashboard-plugin-runtime/host`).
- Rows keyed `(from, to)`; line numbers never enter the key. NEW edge, STALE row, UNANNOTATED row (missing `reason`/`disposition`/`removedBy`) all exit 1.
- Manifest-derived exemptions, recomputed every run, never rows: generated `plugin-registry.tsx` + `plugin-sources.css`; `packages/client/package.json` `dependencies` on a bundled plugin (non-fixture, declares `client`); fixture plugins from tests / `devDependencies`.
- Flags: `--root <dir>`, `--allowlist <file>`, `--no-allowlist` (every edge NEW), `--write-baseline` (re-seed; keep annotations of surviving rows, drop stale, add new with `TODO`).
- Exit 0 ok, 1 violations, 2 script error. Deps: node builtins + `typescript` only.
- Exports `findEdges`, `reconcile`, `rebaseline`, `isTestFile`.
- Tests: `__tests__/check-plugin-boundary.test.mjs` (test-plan #E1–#E9); `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts` (#E10).

See change: decouple-plugins-from-core.
