## Why

`detectOpenSpecActivity` in `packages/shared/src/openspec-activity-detector.ts` captures any non-whitespace, non-quote token from `openspec/changes/<name>/...` paths and `openspec <verb> <name>` commands as `changeName`. The auto-attach + auto-rename cascade in `packages/server/src/event-wiring.ts` then renames any unnamed session to that captured token.

The earlier fix `fix-openspec-flag-rename-bug` (archived 2026-04-28) only rejected tokens starting with `-`, on the explicit premise that "the detector is the single source." That premise no longer holds: UUID-shaped tokens (e.g., `019df0aa-...`) appear in real workflows — agents reference session IDs in paths, scripts, or commands — and they slip past the `-` guard. The session card then shows the UUID as its name, exactly the symptom the prior fix was meant to eliminate.

This change is the second instance of the same class of regression. We tighten the detector to a positive shape rule (allowlist) and add a defense-in-depth guard at the rename site so a future detector regression cannot rename sessions to junk.

## What Changes

- `detectOpenSpecActivity` SHALL only return `changeName` when the captured token matches a valid OpenSpec change-slug shape: `^[a-z][a-z0-9-]{0,63}$` (lowercase, must start with a letter, kebab-case allowed). Tokens that fail this check return `null` — same contract as the `-` guard from `fix-openspec-flag-rename-bug`.
- The auto-attach branch in `event-wiring.ts` SHALL re-validate `detected.changeName` against the same slug-shape rule before stamping `openspecChange`, attaching, or renaming. This is intentional defense-in-depth — the prior proposal explicitly rejected duplication, but two regressions of the same class justify revisiting that decision.
- The slug-shape predicate SHALL live in a single shared helper (`isValidOpenSpecChangeSlug` in `packages/shared/src/openspec-activity-detector.ts`) consumed by both call sites.
- Add regression coverage for: `Read openspec/changes/<UUID>/proposal.md`, `Write openspec/changes/<UUID>/spec.md`, `bash: openspec archive <UUID>`, plus positive controls (`add-auth`, `fix-mobile-attach`).
- No migration. Already-corrupted sessions (`name = "<UUID>"`, `attachedProposal = "<UUID>"`) can be cleaned up via the existing rename / detach UI.

Not breaking. Not user-visible beyond "sessions stop being renamed to UUIDs."

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `proposal-attachment`: tighten the existing "Activity detection with isActive flag" requirement — `changeName` MUST match the OpenSpec change-slug shape. Add a new SHALL on the auto-attach path: re-validate `changeName` shape before stamping or renaming.

## Impact

- **Code**:
  - `packages/shared/src/openspec-activity-detector.ts` — add `isValidOpenSpecChangeSlug` helper; gate every `changeName` return through it.
  - `packages/server/src/event-wiring.ts` — re-validate `detected.changeName` in the auto-attach branch before mutating session state.
  - `packages/shared/src/__tests__/openspec-activity-detector.test.ts` (or co-located file) — UUID + flag + valid-slug coverage.
  - `packages/server/src/__tests__/auto-attach.test.ts` — assert no rename/attach when the detector returns a UUID-shaped token (defensive layer).
- **APIs**: `DetectedActivity` shape unchanged.
- **Behavior**: Sessions referencing UUID-shaped paths/CLI args stay un-renamed and un-attached. Manual attach/rename are unaffected.
- **No persistence change. No protocol change. No migration.**
