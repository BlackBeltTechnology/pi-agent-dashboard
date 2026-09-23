## Context

`verify-published-imports.mjs` derives the shipped file set from `npm pack --dry-run --json`, then classifies each specifier. `relativeResolves(spec, fromFile, packedSet)` already detects `dangling-relative-import`. tsconfig `extends` is the same class of reference: a relative path that must land inside the tarball.

## Decisions

1. **Reuse the pack-derived file set, not a glob.** This is consistent with the existing check. `npm pack` is the source of truth.
2. **Only relative `extends` are checked.** A bare specifier such as `@tsconfig/node20/tsconfig.json` is a package reference. It is out of scope here; the existing dependency-declaration rules could cover it later.
3. **`extends` may be a string or an array (TS ≥5.0).** Check each entry. If the target has no `.json` suffix, also try `<target>.json`, which matches how TypeScript resolves it.
4. **Parse tsconfig as JSONC.** tsconfig allows comments and trailing commas. Use a minimal strip (comments, trailing commas) before `JSON.parse`, and add no dependency. An unparseable shipped tsconfig is reported as a `warn` finding and is not treated as a crash.
5. **Root package inclusion.** `listWorkspaces` gains the repo root as a candidate when its `package.json` is not `private`. The root manifest's `rel` is `"."`.

## Alternatives rejected

- **Inline `compilerOptions` into each package tsconfig and drop `extends`.** This fixes the symptom, but it duplicates config and leaves the check blind to the next case.
- **Stop shipping package tsconfigs.** jiti may still need them for path and compiler settings. That is riskier than shipping one extra file.

## Risks

- Scanning the root package may surface existing findings, for example root-shipped files that import devDependencies. Mitigation: triage during apply, then fix or allowlist each one with a reason.
- The root cause attributed to jiti 2.7 comes from correlation between versions and is unconfirmed. The fix does not depend on it.
