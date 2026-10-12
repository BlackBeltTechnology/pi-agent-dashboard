## 1. Config fixes (land green on 5.9 first)

- [x] 1.1 Add `"types": ["node"]` to `packages/kb/tsconfig.json`, `packages/context-budget/tsconfig.json` and `packages/bus-client/tsconfig.json` (not `tsconfig.base.json`, design D2); their builds and `npm run lint` stay green on 5.9
- [x] 1.2 `packages/bus-client/tsconfig.json`: add `"lib": ["ES2023", "DOM"]`
- [x] 1.3 `packages/team-app/tsconfig.json`: remove `baseUrl`; keep `paths` relative to the tsconfig; the 5.9 error count stays at the pre-existing 8
- [x] 1.4 `tests/e2e/helpers/windowed-session.ts:543`: pass strings/Blobs through; copy views with `new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()` and raw buffers with `new Uint8Array(data).slice()` (design D4; no `any` cast)
- [x] 1.4a Declare `@types/node` explicitly in root devDependencies (today only transitive) at the currently resolved version
- [x] 1.5 Regenerate the kb engine fingerprint after the `packages/kb/tsconfig.json` edit (`npm run build` in `packages/kb`) and commit `packages/kb/engine-fingerprint.json`; `node scripts/check-kb-dist-fresh.mjs` passes

## 2. TypeScript 7 alongside 5.9

- [x] 2.1 Root devDependencies: add `"typescript-7": "npm:typescript@7.0.2"` (exact pin); keep `typescript` 5.x; `pnpm install`; commit the lockfile
- [x] 2.2 Add `scripts/tsc7.mjs`: resolve `typescript-7/package.json` with `createRequire(import.meta.url)`, join its `bin.tsc` (the `exports` map hides `bin/tsc`), run it with `process.execPath`, forward argv, stdio and exit code; when `typescript-7` does not resolve, exit 1 with one stderr line naming the alias and `pnpm install`
- [x] 2.3 Switch root `lint`, `lint:e2e`, `quality:changed` to `node scripts/tsc7.mjs`, and `packages/team-app` `typecheck` plus the `build` scripts of `app-kit`, `bus-client`, `context-budget`, `kb` to `node ../../scripts/tsc7.mjs` (package cwd)
- [x] 2.4 Move the remaining callers: `npx tsc --noEmit` in `scripts/reload-all.sh:42`, `scripts/build.sh:37`, `scripts/rebuild-restart.sh:28` and `packages/bus-client/src/__tests__/send-types.test.ts:21` to the wrapper; `packages/kb/bin/kb.mjs` `findTsc()` (`:29-35,63`) prefers `<repo>/scripts/tsc7.mjs` (walk up) and falls back to `typescript/lib/tsc.js`, so `engine-fingerprint.test.ts` fixtures and the published kb tarball keep working; leave `viewer-registry.test.tsx:259` on 5.9 (type-contract probe)

## 3. Tests (folded from test-plan.md)

- [x] 3.1 L1 wrapper runs TS 7 from the repo root (test-plan #E1); see scripts/__tests__/loader-neutral-source.test.mjs; repo root cwd · `node scripts/tsc7.mjs --version` · exit 0, stdout starts with `Version 7.`
- [x] 3.2 L1 wrapper runs TS 7 from a package directory (test-plan #E2); see scripts/__tests__/loader-neutral-source.test.mjs; `packages/kb` cwd · `node ../../scripts/tsc7.mjs --version` · exit 0, `Version 7.`
- [x] 3.3 L1 wrapper forwards the exit code (test-plan #E3); see scripts/__tests__/loader-neutral-source.test.mjs; temp project with a type error / clean file · `node scripts/tsc7.mjs --noEmit -p <temp>` · non-zero + TS2322 / exit 0 with empty output
- [x] 3.4 L1 wrapper with the alias missing (test-plan #E4); see scripts/__tests__/loader-neutral-source.test.mjs; wrapper copied to a temp dir without `typescript-7` · run `--version` · exit 1, one stderr line naming `typescript-7` and `pnpm install`, no stack trace
- [x] 3.5 L1 no bare `tsc` in type-check invocations (test-plan #E5); see scripts/__tests__/loader-neutral-source.test.mjs; package.json scripts, the 3 shell scripts, `send-types.test.ts` · scan for bare `tsc` / `npx tsc` / `.bin/tsc` · zero matches
- [x] 3.6 L1 `require("typescript")` stays on 5.x (test-plan #E6); see scripts/__tests__/verify-release-deps-client-build-deps.test.mjs; install with both versions · `require("typescript")` · version `5.*`, `createSourceFile` is a function
- [x] 3.7 L1 kb dev rebuild prefers the wrapper (test-plan #E7); see packages/kb/src/__tests__/engine-fingerprint.test.ts; `kb.mjs` in repo / copied to temp with fake `typescript` · trigger rebuild · wrapper spawned / fake `tsc.js` runs (`REBUILT_OK`)
- [x] 3.8 L1 emit identical at the switch-over (test-plan #E8); see scripts/__tests__/verify-release-deps-client-build-deps.test.mjs; app-kit, bus-client, context-budget, kb · build with 5.9 and with the wrapper into temp dirs · `diff -r` empty
- [x] 3.9 L1 codegen still runs on the 5.x API (test-plan #E9); see packages/server/src/__tests__/mcp-manifest-completeness.test.ts; bus-client verb codegen + mcp-server tool codegen · run both · exit 0, output byte-identical to committed files
- [x] 3.10 L1 `BufferSource` copy keeps behaviour (test-plan #E10); see packages/shared/src/__tests__/server-launcher.test.ts (vitest pure-function pattern); patched `send` with string, Blob, offset `Uint8Array` view, raw `ArrayBuffer` · call · underlying `send` receives identical content
- [x] 3.11 L1 docs and skills name the wrapper (test-plan #E11); see scripts/__tests__/loader-neutral-source.test.mjs; `docs/` + `.pi/skills/` minus archived and `*.AGENTS.md` · `git grep -nE '(npx )?tsc --noEmit'` · only wrapper invocations
- [x] 3.12 ci TS 7 platform binary on the Linux runner (test-plan #X1); see the `pnpm run lint` step in .github/workflows/ci.yml; hoisted frozen-lockfile install · `node scripts/tsc7.mjs --version` then `pnpm run lint` · prints `Version 7.`, lint exits 0
- [x] 3.13 ci diagnostics parity (test-plan #X2); see the `pnpm run lint` / `lint:e2e` steps in .github/workflows/ci.yml; none · CI lint, lint:e2e and the 4 package builds · all exit 0
- [x] 3.14 ci kb fingerprint stays fresh (test-plan #X3); see the "kb dist freshness (engine fingerprint)" step in .github/workflows/ci.yml; `packages/kb/tsconfig.json` edited · `node scripts/check-kb-dist-fresh.mjs` · exit 0
- [x] 3.15 L1 team-app does not regress on TS 7 (test-plan #X4); see scripts/__tests__/loader-neutral-source.test.mjs; `packages/team-app` · `node scripts/tsc7.mjs --noEmit -p packages/team-app` · ≤ 8 errors, only TS18049/TS2339/TS2345

## 4. Docs

- [x] 4.1 `docs/code-quality.md`: TS 7 is the CI checker, editors may run 5.9, and CI is authoritative; record tsc-rs as an evaluated alternative (delegate `docs/` prose to DocScribe)
- [x] 4.2 Update every `tsc --noEmit` / `npx tsc` instruction to the wrapper: `.pi/skills/code-quality/SKILL.md:32,59,81`, `.pi/skills/implement/references/rebuild-matrix.md:29`, `docs/faq.md:859`, `docs/code-quality.md` (incl. `:426`), `docs/code-quality.agent.md:52,73,85` (delegate `docs/` prose to DocScribe); afterwards `git grep -nE '(npx )?tsc --noEmit' -- docs .pi/skills ':!docs/qa/archived-*' ':!*.AGENTS.md'` lists only wrapper invocations
- [x] 4.3 Update `AGENTS.md` rows for touched files (`scripts/tsc7.mjs`, tsconfigs)
