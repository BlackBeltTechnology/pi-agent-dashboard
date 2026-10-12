## Context

Today `typescript@5.9.3` is the only compiler. `lint` = `tsc --noEmit` (`package.json:76`),
`lint:e2e` = `tsc -p tests/tsconfig.json --noEmit` (`package.json:77`), and `quality:changed` runs
`tsc` three times (`package.json:80`: twice directly, once through `lint:e2e`). Other `tsc`
callers: `packages/kb/bin/kb.mjs:29-35,63` (`findTsc()` hard-codes
`node_modules/typescript/lib/tsc.js` for the kb dev rebuild) and `npx tsc --noEmit` in
`scripts/reload-all.sh:42` (behind `npm run reload`), `scripts/build.sh:37` and
`scripts/rebuild-restart.sh:28`. Two tests run a compiler too:
`packages/bus-client/src/__tests__/send-types.test.ts:21` (spawns `node_modules/.bin/tsc` on
`tsconfig.fixtures.json`) and
`packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx:259` (runs
`typescript/lib/tsc.js`, so it stays on 5.9 by design: it probes a type contract, not the CI
checker). The packages built with `tsc` are `app-kit`
(`tsconfig.build.json`), `bus-client`, `context-budget` and `kb`. The base config is
`tsconfig.base.json` (ES2022, `moduleResolution: bundler`, no `types`).

**Measurements (2026-10-11, Apple M-series; official `typescript@7.0.2`, and `tsc-rs@0.3.0` as a
reference):**

| Project | tsc 5.9 | TS 7.0.2 | tsc-rs 0.3.0 | TS 7 vs tsc-rs diagnostics |
|---|---|---|---|---|
| root `tsconfig.json` | 17.3 s, 0 errors | 2.27 s, 0 | 1.11 s, 0 | identical |
| `tests/tsconfig.json` | 1.8 s, 0 | 1 (TS2322) | 1 | identical |
| `packages/team-app` | 8 (pre-existing) | 1 (TS5102 `baseUrl`); the same 8 once `baseUrl` is removed | 1 | identical |
| `bus-client` / `context-budget` / `kb` | 0 | 1 / 6 / 184 | same | identical |
| `app-kit` build | 0 | 0 | 0 | identical; emit byte-identical |

All TS 7 failures come from three TS 7 semantic changes, not from defects:

1. `types` defaults to `[]` (no automatic inclusion of `node_modules/@types/*`). The root program
   still sees `@types/node`, but only through transitive type references
   (`pino-std-serializers`, `undici-types`, per `tsc --explainFiles`). Package programs such as
   `kb` (202 `@types` files on 5.9, none on TS 7) lose it, so `Buffer` and `node:*` are unresolved
   (TS2591) and types degrade to `any`. The emitted `kb` `dist/chunker.d.ts` showed
   `sha: (s: string) => any` until this was fixed.
2. `baseUrl` was removed (TS5102).
3. The `lib.dom` `BufferSource` became `ArrayBufferView<ArrayBuffer>`, so
   `ArrayBufferView<ArrayBufferLike>` no longer assigns
   (`tests/e2e/helpers/windowed-session.ts:543`).

With `--types node` on `kb`/`context-budget`/`bus-client` (plus `--lib ES2023,DOM` for
`bus-client`), every project is clean apart from items 2 and 3. TS 7 emit for `app-kit`, `bus-client`, `context-budget` and `kb` is byte-identical
to tsc 5.9.

**The JS API is gone from TS 7:** `require("typescript")` on 7.0.2 resolves to `lib/version.cjs`
(`createSourceFile` and `transpileModule` are `undefined`). Its API sits under
`typescript/unstable/*`. Consumers of the 5.x API: `packages/bus-client/src/codegen/generate-verbs.ts`,
`packages/mcp-server-plugin/codegen/generate-tools.ts`,
`packages/client/src/lib/__tests__/{ui-copy-no-spawn,aligned-surfaces-no-literals}.test.ts`,
`packages/server/src/__tests__/{push-dispatcher,mcp-manifest-completeness}.test.ts`,
and `scripts/verify-published-imports.mjs`. (`knip` 6.33 does not use `typescript`; the only
`node_modules` dependents are `config-file-ts` and an Electron Forge template that nests its own
copy.)

**Bin collision (verified on the repo's pnpm 11.15.1 and on 12.10.1, `nodeLinker: hoisted`):** with `typescript@5.9.3` and
`typescript-7@npm:typescript@7.0.2` both installed, `node_modules/.bin/tsc` links to
`../typescript-7/bin/tsc` while `require("typescript")` returns 5.9.3. The link order is not a
contract.

## Goals / Non-Goals

**Goals:**
- Every type-check and every `tsc` build runs on TypeScript 7.
- The 5.x JS API stays available to its consumers.
- The configs pass on TS 7 with no change to emitted output.

**Non-Goals:**
- Migrating the codegen and tests to TS 7's `unstable` API.
- Fixing the 8 pre-existing `packages/team-app` errors.
- Adopting `tsc-rs` (see Open Questions).
- Editor configuration (`.vscode`).

## Decisions

### D1 — Install TS 7 as an alias and call it by explicit path

Add `"typescript-7": "npm:typescript@7.0.2"` (pinned exactly) to the root devDependencies. Scripts
call the wrapper `scripts/tsc7.mjs`. TS 7's `exports` map hides `bin/tsc` and `lib/*`
(`require.resolve("typescript-7/bin/tsc")` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`), so the wrapper
resolves `typescript-7/package.json` with `createRequire(import.meta.url)` (so it works from any
cwd), joins its `bin.tsc`, and runs that file with `process.execPath`, forwarding argv, stdio and
exit code (verified: prints `Version 7.0.2`). Root scripts call `node scripts/tsc7.mjs`; package scripts run
with the package directory as cwd and call `node ../../scripts/tsc7.mjs`. The three shell scripts and
`send-types.test.ts` move to the wrapper. `kb.mjs`'s `findTsc()` prefers the repo wrapper
(`<repo>/scripts/tsc7.mjs`, found by walking up) and falls back to today's
`typescript/lib/tsc.js` when it is absent. That keeps the published kb tarball (which has no repo
`scripts/`) and the `engine-fingerprint.test.ts` fixtures (which copy `kb.mjs` to a temp dir and
plant a fake `typescript`) working, and the wrapper stays the single switch. After this,
nothing in the repo runs `node_modules/.bin/tsc` or `npx tsc`.

*Rejected:* replacing `typescript` with 7.x. That breaks the 7 API consumers (codegen, tests,
`verify-published-imports.mjs`).
*Rejected:* `@typescript/native-preview` (`tsgo` bin, no collision). It is a nightly preview
channel, while 7.0.2 is the stable release.

### D2 — `"types": ["node"]` only in the package tsconfigs that need it; `DOM` lib only where it is reached

The `types` fix goes into `packages/kb/tsconfig.json`, `packages/context-budget/tsconfig.json` and
`packages/bus-client/tsconfig.json` (which also gets `lib: ["ES2023", "DOM"]`, because its import
graph reaches `slot-props.ts`). `tsconfig.base.json` is **not** touched:
- The root program needs nothing: on TS 7 it type-checks with 0 errors as is (it reaches
  `@types/node` transitively), and `app-kit` is clean too.
- Putting `types: ["node"]` in the base would switch off 5.9's implicit "all of `@types/*`" for
  every per-package tsconfig that editors open. Measured on 5.9: `packages/server` 32 → 102
  errors (`Response.json()` becomes `unknown` once DOM-bearing `@types` drop out),
  `packages/shared` 0 → 5, `packages/cost-estimator` 0 → 4. On TS 7 it would also surface TS6059
  (`rootDir`) in six plugin packages.
- `types` is replaced, not merged, across `extends`; scoping it to leaf configs keeps that local.

`@types/node` is only present transitively today, so it becomes an explicit root devDependency.

### D3 — `team-app`: drop `baseUrl`, keep `paths` relative to the tsconfig

TS 7 resolves `paths` relative to the tsconfig directory. Since `baseUrl` is `"."`, the
mappings are unchanged. Measured: TS 7 on team-app without `baseUrl` reports the same 8
pre-existing errors as 5.9 (5× TS18049, TS2339, 2× TS2345).

### D4 — Fix the `BufferSource` assignment at the call site

The parameter is `string | ArrayBufferLike | Blob | ArrayBufferView`, and **both** binary arms fail
under TS 7 (`ArrayBufferLike` includes `SharedArrayBuffer`; a view's buffer may be one too). Pass
strings and Blobs through; copy views with
`new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()` and raw buffers with
`new Uint8Array(data).slice()`. Verified to compile on TS 5.9.3 and 7.0.2. No lib widening and no
`any` cast.

## Coordination

- **kb engine fingerprint:** `packages/kb/bin/lib/engine-fingerprint.mjs` hashes kb's whole
  tsconfig extends chain (`packages/kb/tsconfig.json` + `tsconfig.base.json`) into
  `packages/kb/engine-fingerprint.json` (`tsconfigHash`), and CI's
  `scripts/check-kb-dist-fresh.mjs` (`ci.yml:172`) fails when it is stale. This change edits
  `packages/kb/tsconfig.json`, and `strip-only-native-ts-loader` edits `tsconfig.base.json`; each
  regenerates it (`npm run build` in `packages/kb`), and whichever lands second regenerates again.
- **Shared root manifests:** both changes edit root `package.json` devDependencies (`typescript`
  range vs the `typescript-7` alias), `packages/app-kit/package.json` and `pnpm-lock.yaml`;
  whichever lands second rebases and reinstalls. `strip-only-native-ts-loader`'s tasks 1.2/1.5 and
  test-plan E10 already say to use the wrapper when this change has landed, and bare `tsc`
  otherwise. TS 7 reports TS1294
  under `erasableSyntaxOnly` exactly like 5.9.

## Risks / Trade-offs

- **[Editor and CI diagnostics drift]** (editors on 5.9, CI on 7). TS 7 is stricter in places
  (`lib.dom`). → CI is authoritative. Document in `docs/code-quality.md`.
- **[TS 7 patch releases change diagnostics]** → pin the exact version; bump deliberately.
- **[Two TypeScript copies in `node_modules`]** → about 30 MB more in dev installs and in the docker
  image, which installs dev dependencies (`docker/Dockerfile:193`). Measured:
  `typescript` 3.5 MB plus the platform binary package `@typescript/typescript-<os>-<arch>` 26 MB).
  Published packages are unaffected. CI resolves the Linux binary through optional dependencies;
  verify that the hoisted install picks it up on `ubuntu-latest`.

## Migration Plan

1. Apply the config fixes (D2–D4) while still on 5.9: everything stays green, because 5.9 accepts
   them.
2. Add the `typescript-7` alias and `scripts/tsc7.mjs`, then switch the scripts.
3. Verify parity: every project's diagnostics on TS 7 equal 5.9's (0, except team-app's
   pre-existing 8), and built-package emit is byte-identical.

Rollback, in order: (1) point `scripts/tsc7.mjs` at the `typescript` package (one line; every
repo caller, including `kb.mjs`, goes through it, so they all switch at once); (2) remove the `typescript-7` alias from
`package.json`; (3) `pnpm install` and commit the lockfile (CI uses `--frozen-lockfile`); (4)
confirm `node_modules/.bin/tsc --version` prints 5.x. Step 1 alone already restores 5.9 for the
repo; steps 2–4 restore the bare `tsc` link too.

## Open Questions

- **tsc-rs as the checker?** It matched TS 7.0.2's diagnostics exactly on all 7 projects and runs
  about 2× faster again (1.1 s vs 2.3 s on root). It is a drop-in CLI (`tsc-rs -p …`), so the
  switch is one line in `scripts/tsc7.mjs`. It is not adopted now: it is v0.3.0, maintained by one
  author, pinned to an upstream revision, and its author states they have not read the code. Re-evaluate once it
  has a track record. Its exit code differs (2 instead of TS 7's 1), which is harmless for `&&` chains.
