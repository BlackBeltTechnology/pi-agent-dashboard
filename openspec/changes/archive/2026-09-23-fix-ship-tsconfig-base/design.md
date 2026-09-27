## Context

`verify-published-imports.mjs` derives the shipped file set from `npm pack --dry-run --json`, then classifies each specifier. `relativeResolves(spec, fromFile, packedSet)` already detects `dangling-relative-import`. tsconfig `extends` is the same class of reference: a relative path that must land inside the tarball.

## Decisions

1. **Reuse the pack-derived file set, not a glob.** This is consistent with the existing check. `npm pack` is the source of truth.
2. **Only relative `extends` are checked.** A bare specifier such as `@tsconfig/node20/tsconfig.json` is a package reference. It is out of scope here; the existing dependency-declaration rules could cover it later.
3. **`extends` may be a string or an array (TS ≥5.0).** Check each entry. If the target has no `.json` suffix, also try `<target>.json`, which matches how TypeScript resolves it.
4. **Parse tsconfig as JSONC via `ts.parseConfigFileTextToJson`.** `typescript` is already imported by the checker, so no new dependency and no hand-rolled comment stripping. An unparseable shipped tsconfig is reported as `unparseable-tsconfig` (warning), not a crash.
5. **Root package: tsconfig rule only (decided during ship-it).** A non-private root is checked through `rootPackage(root)`, with `rel: "."`, and only for tsconfig `extends`. Measured: the full import rules on the root produce ~250+ findings (`undeclared-import fastify` ×141, dangling relative imports into `client/`, `qa/`, `scripts/` from the shipped `__tests__`). The root is a meta-package that ships `packages/server/src/` and resolves its deps transitively via `@blackbelt-technology/pi-dashboard-server`. A full root import check → a separate follow-up change. `listWorkspaces` is unchanged.
6. **Root pack payload shape.** At a workspace root, `npm pack --dry-run --json` emits an object keyed by package name, not an array. Before this change, `packWorkspace` read `entry.files` → `[]`, so a root check would pass vacuously. New pure `packEntryFiles(parsed)` accepts array, single-object, and keyed-object forms. It returns null when there is no `files` array, which is reported as `pack-failed`.

## Alternatives rejected

- **Inline `compilerOptions` into each package tsconfig and drop `extends`.** This fixes the symptom, but it duplicates config and leaves the check blind to the next case.
- **Stop shipping package tsconfigs.** jiti may still need them for path and compiler settings. That is riskier than shipping one extra file.

## Risks

- The root's full import-correctness gap stays open (see Decision 5). It is tracked as a follow-up.
- The root cause attributed to jiti 2.7 comes from correlation between versions and is unconfirmed. The fix does not depend on it.
