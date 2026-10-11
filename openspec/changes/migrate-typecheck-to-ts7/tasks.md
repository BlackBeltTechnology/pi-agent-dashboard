## 1. Config fixes (land green on 5.9 first)

- [ ] 1.1 Add `"types": ["node"]` to `tsconfig.base.json`; `npm run lint` stays at 0 errors on 5.9
- [ ] 1.2 `packages/bus-client/tsconfig.json`: add `"lib": ["ES2023", "DOM"]`
- [ ] 1.3 `packages/team-app/tsconfig.json`: remove `baseUrl`; keep `paths` relative to the tsconfig; the 5.9 error count stays at the pre-existing 8
- [ ] 1.4 `tests/e2e/helpers/windowed-session.ts:543`: narrow or copy to `Uint8Array<ArrayBuffer>` so the stricter `lib.dom` `BufferSource` accepts it (no `any` cast)

## 2. TypeScript 7 alongside 5.9

- [ ] 2.1 Root devDependencies: add `"typescript-7": "npm:typescript@7.0.2"` (exact pin); keep `typescript` at 5.9.3; `pnpm install`
- [ ] 2.2 Add `scripts/tsc7.mjs`, which execs `node_modules/typescript-7/bin/tsc` with the forwarded argv and exit code
- [ ] 2.3 Switch `lint`, `lint:e2e`, `quality:changed`, `packages/team-app` `typecheck` and the `build` scripts of `app-kit`, `bus-client`, `context-budget`, `kb` to `node scripts/tsc7.mjs`

## 3. Parity verification

- [ ] 3.1 Diagnostics: root, `tests`, `bus-client`, `context-budget`, `kb`, `app-kit` all report 0 errors on TS 7; `team-app` reports no more than its pre-existing 8
- [ ] 3.2 Emit: build the four packages with 5.9 and TS 7 into temp dirs; `diff -r` reports no differences
- [ ] 3.3 API consumers: `bus-client` and `mcp-server-plugin` codegen, the 4 API tests, `scripts/verify-published-imports.mjs` and `npm run knip` pass on 5.9
- [ ] 3.4 CI `ubuntu-latest`: the hoisted install resolves the Linux TS 7 platform binary; `pnpm run lint` and `lint:e2e` green

## 4. Docs

- [ ] 4.1 `docs/code-quality.md`: TS 7 is the CI checker, editors may run 5.9, and CI is authoritative; record tsc-rs as an evaluated alternative (delegate `docs/` prose to DocScribe)
- [ ] 4.2 Update the `code-quality` skill's oracle description if it names `tsc --noEmit` literally
- [ ] 4.3 Update `AGENTS.md` rows for touched files (`scripts/tsc7.mjs`, tsconfigs)
