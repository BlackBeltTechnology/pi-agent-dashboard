# Spike — what the `**/__tests__/**` ignore hides at HEAD (#1059)

Measured 2026-11-03 on a `git clone --local` of `develop` @ `43fc54fd4` in a scratch clone
(CLI 2.27.2, `codeql/javascript-queries@2.4.7`, local model pack hash `bd01ad40…`, real `node scripts/codeql-local.mjs`).
Only the shared config / one scratch file changed per run; no file in the real checkout was touched.

| Run | Config / tree change | Local results | vs baseline |
|---|---|---|---|
| 0 shipped | none | 90 | pass, 0 stale |
| 1 un-ignore `**/__tests__/**` | drop that one glob (`*.test.*` / `*.spec.ts` globs stay) | 101 | 11 NEW |
| 2 un-ignore ALL test globs | also drop `**/*.test.ts`, `.test.tsx`, `.test.mjs`, `**/*.spec.ts` | 148 | 58 NEW |
| 3 anchor | shipped config + scratch `scripts/codeql-anchor/plugin-routes.mjs` (real `Fastify()` passed to 5 plugin registrars, `{}` deps) | 108 | 18 NEW |

## Run 1 — 11 NEW

- 9 `js/path-injection` in `packages/team-plugin/src/server/paths.ts` (150, 151×2, 152, 153) and `records.ts` (65, 79, 99, 109).
- 1 `js/bad-tag-filter` in `packages/electron/src/__tests__/loading-page-harness.ts:45` (test helper, not a `*.test.*` file).
- 1 `js/insufficient-password-hash` in `packages/obs-studio-plugin/src/core/__tests__/fake-obs.ts:35` (test helper).
- Only team-plugin recovers: its call path is `packages/team-plugin/src/server/__tests__/harness.ts:145` (not matched by a `*.test.*` glob). The automation call paths are `*.test.ts` files (`routes-stop.test.ts`, `routes-create-action-kind.test.ts`), still ignored.

## Run 2 — 58 NEW

- 20 production plugin-server results: `automation-plugin` `automation-writer.ts` 6 + `run-store.ts` 2 (path-injection), `team-plugin` `paths.ts` 5 + `records.ts` 4 (path-injection), `goal-plugin` `routes.ts` 1 (tainted-format-string), `blackhole-plugin` `index.ts` 1 + `roles-plugin` `roles-routes.ts` 1 (missing-rate-limiting).
- 38 results inside test files (bad-code-sanitization 6, bad-tag-filter 4, incomplete-sanitization 4+1+9, shell-command-injection-from-environment 10, password-hash 1, url-redirection 1, dynamic-method-call 1, incomplete-url-scheme-check 1). All test fixtures, none a product defect. Un-ignoring test code is not worth it.

## Run 3 — 18 NEW (anchor, shipped config unchanged)

`automation-writer.ts` 6, `run-store.ts` 2, `team-plugin/paths.ts` 5, `records.ts` 4 (path-injection), `goal-plugin/routes.ts:345` 1 (tainted-format-string).
Not recovered: the 2 `js/missing-rate-limiting` (blackhole, roles). The spike passed `{}` deps, so a handler may be unreachable; implementation iterates the anchor to recover them or records them as not recoverable.

## Reading

- The original "29 results" (archive `2026-10-17-harden-codeql-ratchet-followups` `evidence/local-vs-ci.md`: path-injection 23, rate-limiting 5, format-string 1) is stale. The reachable hidden set at HEAD is 20 production results (rate-limiting 2). Barrier models and admission changes since then closed the rest.
- The hidden results sit in PRODUCTION plugin server files, not in `__tests__`. The ignore removes only the test-side `Fastify()` → registrar call path that made those handlers recognisable as HTTP sources (production loads plugins dynamically; `FastifyInstance` is a type-only import).
- Caveat: the scratch clone symlinked `node_modules` (not ignored by `node_modules/`). The extractor resolves `import Fastify from "fastify"` by name, and CI runs build-mode none with no install, so the implementation re-proves the anchor with no `node_modules` present.
