## Why

In the Add Folders dialog you can only select a folder while it is someone else's child — the moment you navigate *into* a folder, it loses its checkbox and exists only as text in the path input. Users who browse into the exact folder they want to add then find no way to add it (the commit button stays disabled until something is ticked) and hunt for a non-existent "add this folder" button. The natural gesture — enter the target, then grab it — is a dead end.

## What Changes

- Add a **self-row** to the multi-select picker representing the directory currently being browsed, carrying the same checkbox/selection grammar as child rows. Ticking it adds the current folder to the existing basket; it commits through the same pin/workspace flow.
- Adopt an **inset-grouped-list** treatment (Apple HIG): the self-row sits accent-tinted at the top of the list, followed by a single small `CONTENTS` eyebrow (10px, uppercase, muted) that marks where browsing begins. Selected mock: `openspec/changes/add-current-folder-to-add-flow/mockups/self-row.html` (variant **D · v2**).
- The self-row uses the **open-folder** MDI glyph (vs. children's closed folder) and renders **no trailing chevron** — you cannot descend into where you already are.
- The self-row renders **only when a real current directory is resolved** (hidden during the initial default-directory load and when the browsed location has no addressable self path).
- Multi-tick of children is unchanged and continues to coexist with self-row selection in one basket.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `multi-select-folder-picker`: add a requirement that the currently-browsed directory is itself selectable via a dedicated self-row (open-folder icon, no chevron, same checkbox/basket semantics), placed above a small `CONTENTS` group label, and rendered only when a current directory exists.

## Discipline Skills

- `review-code` — non-trivial client-component change; run the inline review→fix loop before commit.
- Not triggered: `security-hardening` (no auth/untrusted-input/secrets), `performance-optimization` (no latency/throughput budget — one extra static row), `observability-instrumentation` (no new endpoint/job/external call), `systematic-debugging` (no bug under investigation).

## Impact

- `packages/client/src/components/primitives/PathPicker.tsx` — new `DisplayItem` self variant + presentational `CONTENTS` label (not a `role=option`); render-gated on a non-empty absolute current-dir path; `handleItemClick`/Enter/Space gain a `self` case (toggle, never descend); checkbox membership compares canonically (not raw `entry.path`); self-row carries the session badge.
- `packages/client/src/components/workspace/AddFoldersDialog.tsx` — no new props; self path flows through the existing `selection`/basket contract; `leafName` gains a full-path fallback so filesystem-root pills are non-empty.
- Tests: `packages/client/src/components/__tests__/PathPicker.test.tsx` (self-row present/absent, tick → basket, no-chevron, open-icon).
- No server, protocol, or persistence changes.
