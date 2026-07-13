## Why

When the split content viewer opens, the editor pane's **Files** rail (the
left-hand file-tree browse rail) is shown by default (`tree-visible.ts`
`DEFAULT_VISIBLE = true`). On a narrow split — and on mobile, where the split
stacks vertically — the rail eats horizontal room the viewer needs, so the file
you just opened renders in a cramped column next to a tree you did not ask for.

The common entry point is `openInSplit(path)` (chat file-link, tool-result
path, tree click, search-result select): the user is opening a **specific
file**, not browsing. Defaulting the rail open optimizes for the rarer browse
case at the expense of the common read case.

The reveal affordance already exists and is always present: the labelled
`[Files]` toggle sits in the pane header regardless of rail state, so a
collapsed default is never a dead-end — one click brings the tree back.

## What Changes

- Flip `tree-visible.ts` `DEFAULT_VISIBLE` from `true` to `false`, so a session
  with no persisted rail preference opens the split with the Files rail
  **collapsed**. The viewer fills the freed width.
- The existing **per-session persistence is unchanged**: once the user reveals
  the rail via the `[Files]` toggle, that choice is saved under
  `pi-dashboard:tree-visible:<sessionId>` and survives reload for that session
  ("collapsed by default *for session*"). Only the absence-of-preference
  default flips.
- Update the module doc comment ("defaults to visible" → "defaults to
  collapsed") and the three `tree-visible.test.ts` default-expectation
  assertions. The explicit-persist test cases are unaffected.

Non-goals: no new UI, no settings toggle (the default stays hard-coded, just
inverted); no change to the storage key, the reveal affordance, or the
collapse-on-every-open behavior (a user's persisted expand stays sticky — the
rail does NOT re-collapse each time the split reopens); the empty-state copy
("No files open — pick one from the tree") is left as-is.

## Impact

- `packages/client/src/lib/tree-visible.ts` — `DEFAULT_VISIBLE = false`; doc
  comment reworded. No signature/API change; `EditorPane` consumes the hook
  unchanged.
- `packages/client/src/lib/__tests__/tree-visible.test.ts` — flip the three
  default-expectation assertions (absence → `false`; hook initial → `false`;
  session-switch-to-unknown → `false`). Explicit `true`/`false` persistence
  cases unchanged.
- `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx` —
  the rail-toggle test starts from the collapsed default (initial
  `aria-pressed=false`, no `rail-divider`), then asserts the reveal→hide flow
  and persistence.
- `openspec/specs/internal-monaco-editor-pane/spec.md` — the collapsible
  file-tree rail requirement gains an explicit default-collapsed clause + a
  scenario.

## Discipline Skills

None. Client-only default flip, no auth / untrusted-input / perf /
observability surface; standard TDD + code-review + code-quality end gates
apply.
