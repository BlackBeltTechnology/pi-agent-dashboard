## Why

`npm run lint` (`tsc --noEmit` over `packages/*/src`: 8.5k files, 1.65M lines) takes **17.3 s** on
TypeScript 5.9.3. `quality:changed` runs `tsc` three times. TypeScript 7.0.2, the native Go compiler
released as `latest`, checks the same program in **2.3 s** with identical diagnostics. The repo
needs only a few config fixes for TS 7's breaking changes. Measured 2026-10-11 on Apple Silicon.

## What Changes

- **TypeScript 7 becomes the type-check and emit compiler** for `lint`, `lint:e2e`,
  `quality:changed`, `packages/team-app` `typecheck`, and the four `tsc`-built packages (`app-kit`,
  `bus-client`, `context-budget`, `kb`). It is installed as an npm alias (`typescript-7` →
  `typescript@7.0.2`) and invoked by explicit path, because the aliased package's `tsc` bin
  overwrites `node_modules/.bin/tsc` in a non-contractual order.
- **`typescript@5.9` stays installed under its own name**: `typescript@7` has no classic JS API
  (its `"."` export is only `lib/version.cjs`). Seven repo files use the 5.x compiler API
  (`bus-client` and `mcp-server-plugin` codegen, four tests, `scripts/verify-published-imports.mjs`),
  and so does `knip`.
- **Config fixes for TS 7 semantics:**
  - `types` now defaults to `[]`, so add `"types": ["node"]` to `tsconfig.base.json`;
    `bus-client` also needs `"lib": ["ES2023", "DOM"]`, because it reaches
    `shared/src/dashboard-plugin/slot-props.ts`, which uses `HTMLElement`.
  - `baseUrl` was removed: `packages/team-app/tsconfig.json` drops it and rewrites `paths`
    relative to the tsconfig.
  - The stricter `lib.dom` `BufferSource` breaks one assignment at
    `tests/e2e/helpers/windowed-session.ts:543`.
- Emit output of the four built packages stays byte-identical. This was verified with the
  config fixes applied.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `code-quality-loop`: the quality oracle and `lint` scripts run TypeScript 7's compiler; adds a requirement pinning the two-version split (TS 7 compiler, TS 5.x JS API).

## Impact

- **Files:** `package.json` (devDependencies, `lint`, `lint:e2e`, `quality:changed`),
  `packages/{app-kit,bus-client,context-budget,kb,team-app}/package.json` scripts,
  `tsconfig.base.json`, `packages/bus-client/tsconfig.json`, `packages/team-app/tsconfig.json`,
  `tests/e2e/helpers/windowed-session.ts`, new `scripts/tsc7.mjs`, `pnpm-lock.yaml`. CI
  (`ci.yml:173,181`, `publish.yml:118`) already calls `pnpm run lint` / `lint:e2e`, so no workflow edit is needed.
- **Dev only:** no runtime or user-facing change. The published packages' emitted JS and `.d.ts`
  are unchanged.
- **Editors:** VS Code keeps using the workspace `typescript` 5.9 language service unless
  developers opt into TS 7's. Diagnostics can differ slightly, and CI (TS 7) is authoritative.
- **Pre-existing:** `tsc --noEmit -p packages/team-app` already reports 8 errors on 5.9 today
  (TS18049, TS2339, TS2345). This change must not add to them. Fixing them is out of scope.
- **Independent of** `strip-only-native-ts-loader`; either can land first.
- **Rollback:** revert the scripts to `tsc`. TS 5.9 stays installed throughout.

## Discipline Skills

- `doubt-driven-review`: the compiler that gates CI changes; confirm diagnostic parity on every
  project before switching.
- `review-code`: before commit.
- No security, performance-budget or observability triggers (dev tooling only; the speed-up is
  measured, not budgeted).
