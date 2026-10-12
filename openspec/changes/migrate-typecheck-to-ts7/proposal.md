## Why

`npm run lint` (`tsc --noEmit` over `packages/*/src`: 8.5k files, 1.65M lines) takes **17.3 s** on
TypeScript 5.9.3. `quality:changed` runs `tsc` three times. TypeScript 7.0.2, the native Go compiler
released as `latest`, checks the same program in **2.3 s** with identical diagnostics. The repo
needs only a few config fixes for TS 7's breaking changes. Measured 2026-10-11 on Apple Silicon.

## What Changes

- **TypeScript 7 becomes the type-check and emit compiler** for `lint`, `lint:e2e`,
  `quality:changed`, `packages/team-app` `typecheck`, and the four `tsc`-built packages (`app-kit`,
  `bus-client`, `context-budget`, `kb`), plus the kb dev rebuild (`kb.mjs`) and the `npx tsc`
  calls in `scripts/{reload-all,build,rebuild-restart}.sh`. It is installed as an npm alias
  (`typescript-7` → `typescript@7.0.2`) and invoked through one wrapper, `scripts/tsc7.mjs`,
  which resolves it by path, because the aliased package's `tsc` bin takes over
  `node_modules/.bin/tsc`.
- **`typescript@5.9` stays installed under its own name**: `typescript@7` has no classic JS API
  (its `"."` export is only `lib/version.cjs`). Seven repo files use the 5.x compiler API
  (`bus-client` and `mcp-server-plugin` codegen, four tests, `scripts/verify-published-imports.mjs`).
- **Config fixes for TS 7 semantics:**
  - `types` now defaults to `[]`, so `"types": ["node"]` goes into the three package tsconfigs that
    need it (`kb`, `context-budget`, `bus-client`); `tsconfig.base.json` is left alone so editor
    diagnostics on 5.9 don't change. `bus-client` also needs `"lib": ["ES2023", "DOM"]`, because
    it reaches `shared/src/dashboard-plugin/slot-props.ts`, which uses `HTMLElement`.
  - `baseUrl` was removed: `packages/team-app/tsconfig.json` drops it and rewrites `paths`
    relative to the tsconfig.
  - The stricter `lib.dom` `BufferSource` breaks one assignment at
    `tests/e2e/helpers/windowed-session.ts:543` (both binary arms of the parameter need a copy).
  - `@types/node` becomes an explicit root devDependency (today it is only transitive).
- Emit output of the four built packages stays byte-identical. This was verified with the
  config fixes applied.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `code-quality-loop`: the quality oracle and `lint` scripts run TypeScript 7's compiler; the code-quality skill's test gate names the TS 7 type-check; adds a requirement pinning the two-version split (TS 7 compiler, TS 5.x JS API).

## Impact

- **Files:** `package.json` (devDependencies, `lint`, `lint:e2e`, `quality:changed`),
  `packages/{app-kit,bus-client,context-budget,kb,team-app}/package.json` scripts,
  `packages/{kb,context-budget,bus-client,team-app}/tsconfig.json`,
  `tests/e2e/helpers/windowed-session.ts`, new `scripts/tsc7.mjs`, `packages/kb/bin/kb.mjs`,
  `scripts/{reload-all,build,rebuild-restart}.sh`, `packages/kb/engine-fingerprint.json`
  (regenerated), `packages/bus-client/src/__tests__/send-types.test.ts`, `docs/faq.md`, `docs/code-quality.md`,
  `docs/code-quality.agent.md`, `.pi/skills/code-quality/SKILL.md`,
  `.pi/skills/implement/references/rebuild-matrix.md`,
  `pnpm-lock.yaml`. CI
  (`ci.yml:173,181`, `publish.yml:118`) already calls `pnpm run lint` / `lint:e2e`, so no workflow edit is needed.
- **Dev only:** no runtime or user-facing change. The published packages' emitted JS and `.d.ts`
  are unchanged. The docker image grows by about 30 MB (it installs dev dependencies).
- **Editors:** VS Code keeps using the workspace `typescript` 5.9 language service unless
  developers opt into TS 7's. Diagnostics can differ slightly, and CI (TS 7) is authoritative.
- **Pre-existing:** `tsc --noEmit -p packages/team-app` already reports 8 errors on 5.9 today
  (TS18049, TS2339, TS2345). This change must not add to them. Fixing them is out of scope.
- **Independent of** `strip-only-native-ts-loader`; either can land first. Both change kb's
  tsconfig chain and root manifests, so the second to land regenerates the kb engine fingerprint
  and the lockfile.
- **Rollback:** point `scripts/tsc7.mjs` back at TS 5.9 (restores every repo caller at once), then
  remove the `typescript-7` alias and reinstall (design has the ordered steps). TS 5.9 stays
  installed throughout.

## Discipline Skills

- `doubt-driven-review`: the compiler that gates CI changes; confirm diagnostic parity on every
  project before switching.
- `review-code`: before commit.
- No security, performance-budget or observability triggers (dev tooling only; the speed-up is
  measured, not budgeted).
