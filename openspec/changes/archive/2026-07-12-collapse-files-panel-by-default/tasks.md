## 1. Flip the default

- [x] 1.1 In `packages/client/src/lib/tree-visible.ts`, change `DEFAULT_VISIBLE` from `true` to `false`.
- [x] 1.2 Reword the module doc comment: "Best-effort read/write; defaults to visible." → "defaults to collapsed"; adjust the header paragraph likewise ("survives reload… defaults to visible" → collapsed).

## 2. Update tests

- [x] 2.1 In `tree-visible.test.ts`, flip the absence-default assertion (`loadTreeVisible("s1")` → `toBe(false)`).
- [x] 2.2 Flip the hook-initial assertion (`result.current[0]` initial → `toBe(false)`) and the session-switch-to-unknown-session assertion (→ `toBe(false)`).
- [x] 2.3 Leave the explicit-persist cases (persist `false` → reads `false`; persist `true` → reads `true`) unchanged — add an explicit assertion that a persisted `true` still overrides the new collapsed default (regression guard for the per-session stickiness).
- [x] 2.4 Update `EditorPane.test.tsx` rail-toggle test: initial render collapsed (`aria-pressed=false`, no `rail-divider`), then reveal→hide flow with persistence assertions.

## 3. Validate

- [x] 3.1 `tree-visible.test.ts` (4) + `EditorPane.test.tsx` (1) green via `HOME=$(mktemp -d) npx vitest run`.
- [x] 3.2 Manual (browser-verified live): opened the split viewer via the editor deep-link (`openInSplit` path) → Files rail collapsed, Monaco viewer full-width; clicked `[Files]` → tree rail revealed; deployed bundle's Monaco showed the edited "defaults to collapsed" doc comment (build→deploy confirmed).
- [x] 3.3 `openspec validate collapse-files-panel-by-default` passes.
