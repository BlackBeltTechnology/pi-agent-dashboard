## MODIFIED Requirements

### Requirement: Removed predecessors

The following symbols SHALL NOT exist. They were removed when all call sites migrated to `ToolResolver.resolveJiti`, and SHALL NOT be reintroduced:

- `packages/shared/src/resolve-jiti.ts` (file deleted; `resolveJitiImport`, `resolveJitiFromAnchor`, `buildJitiRegisterUrl`, `pickJitiRegisterUrl` and `pickJitiFromAnchor` are subsumed into `ToolResolver.resolveJiti`; the `JitiResolver` type is not removed — it moved verbatim to `packages/shared/src/platform/binary-lookup.ts` as the resolver-injection seam).
- `packages/electron/src/lib/ts-loader-resolver.ts` (file deleted).
- `resolveJitiFromPi` export in `packages/electron/src/lib/server-lifecycle.ts`.
- `deps.resolveJitiFromAnchor` injection seam in `packages/electron/src/lib/launch-source.ts`.

#### Scenario: Symbol-presence check

- **WHEN** the source tree is checked
- **THEN** `git grep -nwE '(resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|pickJitiRegisterUrl|pickJitiFromAnchor|buildJitiRegisterUrl)[[:space:]]*\(' -- packages/ ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**'` returns zero matches (POSIX classes, because `git grep -E` does not honour `\b` / `\s`; call-shaped mentions in comments count as matches)
- **AND** `git grep -nwE 'ts-loader-resolver' -- 'packages/**/*.ts' ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**'` returns zero matches
