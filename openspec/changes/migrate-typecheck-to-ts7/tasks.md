## 1. Config fixes (land green on 5.9 first)

- [ ] 1.1 Add `"types": ["node"]` to `packages/kb/tsconfig.json`, `packages/context-budget/tsconfig.json` and `packages/bus-client/tsconfig.json` (not `tsconfig.base.json`, design D2); their builds and `npm run lint` stay green on 5.9
- [ ] 1.2 `packages/bus-client/tsconfig.json`: add `"lib": ["ES2023", "DOM"]`
- [ ] 1.3 `packages/team-app/tsconfig.json`: remove `baseUrl`; keep `paths` relative to the tsconfig; the 5.9 error count stays at the pre-existing 8
- [ ] 1.4 `tests/e2e/helpers/windowed-session.ts:543`: pass strings/Blobs through; copy views with `new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()` and raw buffers with `new Uint8Array(data).slice()` (design D4; no `any` cast)
- [ ] 1.4a Declare `@types/node` explicitly in root devDependencies (today only transitive) at the currently resolved version
- [ ] 1.5 Regenerate the kb engine fingerprint after the `packages/kb/tsconfig.json` edit (`npm run build` in `packages/kb`) and commit `packages/kb/engine-fingerprint.json`; `node scripts/check-kb-dist-fresh.mjs` passes

## 2. TypeScript 7 alongside 5.9

- [ ] 2.1 Root devDependencies: add `"typescript-7": "npm:typescript@7.0.2"` (exact pin); keep `typescript` 5.x; `pnpm install`; commit the lockfile
- [ ] 2.2 Add `scripts/tsc7.mjs`: resolve `typescript-7/package.json` with `createRequire(import.meta.url)`, join its `bin.tsc` (the `exports` map hides `bin/tsc`), run it with `process.execPath`, forward argv, stdio and exit code
- [ ] 2.3 Switch root `lint`, `lint:e2e`, `quality:changed` to `node scripts/tsc7.mjs`, and `packages/team-app` `typecheck` plus the `build` scripts of `app-kit`, `bus-client`, `context-budget`, `kb` to `node ../../scripts/tsc7.mjs` (package cwd)
- [ ] 2.4 Move the remaining callers: `npx tsc --noEmit` in `scripts/reload-all.sh:42`, `scripts/build.sh:37`, `scripts/rebuild-restart.sh:28` and `packages/bus-client/src/__tests__/send-types.test.ts:21` to the wrapper; `packages/kb/bin/kb.mjs` `findTsc()` (`:29-35,63`) prefers `<repo>/scripts/tsc7.mjs` (walk up) and falls back to `typescript/lib/tsc.js`, so `engine-fingerprint.test.ts` fixtures and the published kb tarball keep working; leave `viewer-registry.test.tsx:259` on 5.9 (type-contract probe)

## 3. Parity verification

- [ ] 3.1 Diagnostics: root, `tests`, `bus-client`, `context-budget`, `kb`, `app-kit` all report 0 errors on TS 7; `team-app` reports no more than its pre-existing 8
- [ ] 3.2 Emit: build the four packages with 5.9 and TS 7 into temp dirs; `diff -r` reports no differences
- [ ] 3.3 API consumers: `bus-client` and `mcp-server-plugin` codegen, the 4 API tests and `scripts/verify-published-imports.mjs` pass on 5.9
- [ ] 3.4 CI `ubuntu-latest`: the hoisted install resolves the Linux TS 7 platform binary; `pnpm run lint` and `lint:e2e` green

## 4. Docs

- [ ] 4.1 `docs/code-quality.md`: TS 7 is the CI checker, editors may run 5.9, and CI is authoritative; record tsc-rs as an evaluated alternative (delegate `docs/` prose to DocScribe)
- [ ] 4.2 Update every `tsc --noEmit` / `npx tsc` instruction to the wrapper: `.pi/skills/code-quality/SKILL.md:32,59,81`, `.pi/skills/implement/references/rebuild-matrix.md:29`, `docs/faq.md:859`, `docs/code-quality.md` (incl. `:426`), `docs/code-quality.agent.md:52,73,85` (delegate `docs/` prose to DocScribe); afterwards `git grep -nE '(npx )?tsc --noEmit' -- docs .pi/skills ':!docs/qa/archived-*' ':!*.AGENTS.md'` lists only wrapper invocations
- [ ] 4.3 Update `AGENTS.md` rows for touched files (`scripts/tsc7.mjs`, tsconfigs)
