## Context

Today `typescript@5.9.3` is the only compiler. `lint` = `tsc --noEmit` (`package.json:75`),
`lint:e2e` = `tsc -p tests/tsconfig.json --noEmit` (`package.json:76`), and `quality:changed` runs
`tsc` twice (`package.json:79`). The packages built with `tsc` are `app-kit`
(`tsconfig.build.json`), `bus-client`, `context-budget` and `kb`. The base config is
`tsconfig.base.json` (ES2022, `moduleResolution: bundler`, no `types`).

**Measurements (2026-10-11, Apple M-series; official `typescript@7.0.2`, and `tsc-rs@0.3.0` as a
reference):**

| Project | tsc 5.9 | TS 7.0.2 | tsc-rs 0.3.0 | TS 7 vs tsc-rs diagnostics |
|---|---|---|---|---|
| root `tsconfig.json` | 17.3 s, 0 errors | 2.27 s, 0 | 1.11 s, 0 | identical |
| `tests/tsconfig.json` | 1.8 s, 0 | 1 (TS2322) | 1 | identical |
| `packages/team-app` | 8 (pre-existing) | 1 (TS5102 `baseUrl`) | 1 | identical |
| `bus-client` / `context-budget` / `kb` | 0 | 1 / 6 / 184 | same | identical |
| `app-kit` build | 0 | 0 | 0 | identical; emit byte-identical |

All TS 7 failures come from three TS 7 semantic changes, not from defects:

1. `types` defaults to `[]`. Without `@types/node`, `Buffer` and `node:*` are unresolved (TS2591),
   which degrades types to `any`. `kb` emitted `sha: (s: string) => any` until this was fixed.
2. `baseUrl` was removed (TS5102).
3. The `lib.dom` `BufferSource` became `ArrayBufferView<ArrayBuffer>`, so
   `ArrayBufferView<ArrayBufferLike>` no longer assigns
   (`tests/e2e/helpers/windowed-session.ts:543`).

With `--types node` (plus `--lib ES2023,DOM` for `bus-client`), every project is clean apart from
items 2 and 3. TS 7 emit for `app-kit`, `bus-client`, `context-budget` and `kb` is byte-identical
to tsc 5.9.

**The JS API is gone from TS 7:** `require("typescript")` on 7.0.2 resolves to `lib/version.cjs`
(`createSourceFile` and `transpileModule` are `undefined`). Its API sits under
`typescript/unstable/*`. Consumers of the 5.x API: `packages/bus-client/src/codegen/generate-verbs.ts`,
`packages/mcp-server-plugin/codegen/generate-tools.ts`,
`packages/client/src/lib/__tests__/{ui-copy-no-spawn,aligned-surfaces-no-literals}.test.ts`,
`packages/server/src/__tests__/{push-dispatcher,mcp-manifest-completeness}.test.ts`,
`scripts/verify-published-imports.mjs`, and `knip` (peer dependency).

**Bin collision (verified, pnpm 12.10.1, `nodeLinker: hoisted`):** with `typescript@5.9.3` and
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
call `node node_modules/typescript-7/bin/tsc …`, wrapped once as `scripts/tsc7.mjs` so that
package scripts and CI don't repeat the path. Nothing depends on `node_modules/.bin/tsc`.

*Rejected:* replacing `typescript` with 7.x. That breaks 7 API consumers and `knip`.
*Rejected:* `@typescript/native-preview` (`tsgo` bin, no collision). It is a nightly preview
channel, while 7.0.2 is the stable release.

### D2 — `"types": ["node"]` in the base config, `DOM` lib only where it is reached

Putting `types` in the base config restores today's effective behaviour for every package that
extends it. `bus-client` gets `lib: ["ES2023", "DOM"]` because its import graph reaches
`slot-props.ts`. The alternative is making that import type-only or splitting the DOM-typed slot
props out of `shared`, which is out of scope.

### D3 — `team-app`: drop `baseUrl`, keep `paths` relative to the tsconfig

TS 7 resolves `paths` relative to the tsconfig directory. Since `baseUrl` is `"."`, the
mappings are unchanged.

### D4 — Fix the `BufferSource` assignment at the call site

Narrow the data to `Uint8Array<ArrayBuffer>`, or copy it before passing. Do not widen the lib or
cast to `any`.

## Risks / Trade-offs

- **[Editor and CI diagnostics drift]** (editors on 5.9, CI on 7). TS 7 is stricter in places
  (`lib.dom`). → CI is authoritative. Document in `docs/code-quality.md`.
- **[TS 7 patch releases change diagnostics]** → pin the exact version; bump deliberately.
- **[Two TypeScript copies in `node_modules`]** → about 30 MB more in dev installs only (measured:
  `typescript` 3.5 MB plus the platform binary package `@typescript/typescript-<os>-<arch>` 26 MB).
  Published packages are unaffected. CI resolves the Linux binary through optional dependencies;
  verify that the hoisted install picks it up on `ubuntu-latest`.

## Migration Plan

1. Apply the config fixes (D2–D4) while still on 5.9: everything stays green, because 5.9 accepts
   them.
2. Add the `typescript-7` alias and `scripts/tsc7.mjs`, then switch the scripts.
3. Verify parity: every project's diagnostics on TS 7 equal 5.9's (0, except team-app's
   pre-existing 8), and built-package emit is byte-identical.

Rollback: point the scripts back to `tsc`.

## Open Questions

- **tsc-rs as the checker?** It matched TS 7.0.2's diagnostics exactly on all 7 projects and runs
  about 2× faster again (1.1 s vs 2.3 s on root). It is a drop-in CLI (`tsc-rs -p …`), so the
  switch is one line in `scripts/tsc7.mjs`. It is not adopted now: it is v0.3.0, maintained by one
  author, pinned to an upstream revision, and its author states they have not read the code. Re-evaluate once it
  has a track record. Its exit code differs (2 instead of TS 7's 1), which is harmless for `&&` chains.
