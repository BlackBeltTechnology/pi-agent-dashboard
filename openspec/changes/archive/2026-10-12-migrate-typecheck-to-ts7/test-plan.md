# Test Plan — migrate-typecheck-to-ts7

Stage: design   Generated: 2026-10-11

No open clarifications. One behaviour that was unspecified (the wrapper when the `typescript-7` alias is missing) was settled in design D1 before this plan was written.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | code-quality-loop · TS 7 compiles (wrapper, root cwd) | EP | L1 | automated | repo root as cwd | `node scripts/tsc7.mjs --version` | exit 0; stdout starts with `Version 7.` |
| E2 | code-quality-loop · TS 7 compiles (wrapper, package cwd) | EP | L1 | automated | `packages/kb` as cwd | `node ../../scripts/tsc7.mjs --version` | exit 0; stdout starts with `Version 7.` |
| E3 | code-quality-loop · wrapper forwards exit code | decision-table | L1 | automated | temp project with (a) `const n: number = "x"`, (b) a clean file | `node scripts/tsc7.mjs --noEmit -p <temp>` | (a) non-zero exit and `TS2322` on stdout; (b) exit 0, empty output |
| E4 | design D1 · alias missing | fault-injection (abort) | L1 | automated | wrapper copied to a temp dir where `typescript-7` does not resolve | run the copy with `--version` | exit 1; exactly one stderr line containing `typescript-7` and `pnpm install`; no stack trace |
| E5 | code-quality-loop · bin link order does not matter | EP (static) | L1 | automated | root and package `package.json` scripts (`lint`, `lint:e2e`, `quality:changed`, team-app `typecheck`, the 4 `build` scripts), `scripts/{reload-all,build,rebuild-restart}.sh`, `packages/bus-client/src/__tests__/send-types.test.ts` | scan for a bare `tsc` / `npx tsc` / `node_modules/.bin/tsc` invocation | zero matches; every type-check invocation goes through `scripts/tsc7.mjs` |
| E6 | code-quality-loop · JS API consumers keep 5.x | EP | L1 | automated | repo install with both TypeScript versions | `require("typescript")` | `.version` starts with `5.`; `typeof createSourceFile === "function"` |
| E7 | design D1 · kb dev rebuild uses the wrapper | decision-table | L1 | automated | (a) `kb.mjs` inside the repo (wrapper reachable); (b) `kb.mjs` copied to a temp dir with a fake `node_modules/typescript/lib/tsc.js` | trigger the kb rebuild path | (a) the wrapper is spawned (TS 7); (b) the fake 5.x `tsc.js` runs (`REBUILT_OK`) |
| E8 | code-quality-loop · output unchanged at the switch-over | state (snapshot) | L1 | automated | `app-kit` (`tsconfig.build.json`), `bus-client`, `context-budget`, `kb` | build each with TS 5.9 and with the wrapper into two temp dirs | `diff -r` reports no differences for any package |
| E9 | code-quality-loop · codegen on the 5.x API | EP | L1 | automated | `bus-client` verb codegen and `mcp-server-plugin` tool codegen | run both generators | exit 0; generated files byte-identical to the committed ones |
| E10 | design D4 · `BufferSource` copy keeps behaviour | EP | L1 | automated | the patched `send` wrapper from `windowed-session.ts` given a string, a Blob, a `Uint8Array` view on an offset slice, and a raw `ArrayBuffer` | call it with each | the underlying `send` receives the same bytes / string / Blob as the input (byte-for-byte for binary) |
| E11 | code-quality-loop · docs and skills name the wrapper | EP (static) | L1 | automated | `docs/` and `.pi/skills/` excluding `docs/qa/archived-*` and `*.AGENTS.md` | `git grep -nE '(npx )?tsc --noEmit'` | every hit is a wrapper invocation |

### Performance

None. The speed-up is the motivation, not a requirement.

### Frontend-quirk

None. No UI behaviour.

### Error-handling (CI / install)

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | code-quality-loop · TS 7 compiles (CI runtime) | EP over platform | ci | automated | Linux runner, hoisted frozen-lockfile install | `pnpm run lint` (preceded by a `node scripts/tsc7.mjs --version` step) | version step prints `Version 7.`; lint exits 0 |
| X2 | code-quality-loop · diagnostics parity | EP over projects | ci | automated | none | CI `lint`, `lint:e2e`, and the 4 package builds | all exit 0 |
| X3 | design · kb fingerprint stays fresh | state | ci | automated | `packages/kb/tsconfig.json` edited by this change | `node scripts/check-kb-dist-fresh.mjs` in CI | exit 0 |
| X4 | code-quality-loop · team-app does not regress | EP | L1 | automated | `packages/team-app` | `node scripts/tsc7.mjs --noEmit -p packages/team-app` | error count ≤ 8 and only codes from {TS18049, TS2339, TS2345} |

---

## Coverage summary

- Requirements covered: 3/3 in the delta (oracle script, skill gate via E11, TS 7 / 5.x split) plus design D1, D4 and the kb fingerprint coordination.
- Scenarios by class: edge 11 · perf 0 · frontend 0 · error 4
- Scenarios by level: L1 12 · ci 3
- Scenarios by disposition: automated 15 · manual-only 0

## New infra needed

- none (X1 adds one version-print step to the existing `ci.yml` lint job)
