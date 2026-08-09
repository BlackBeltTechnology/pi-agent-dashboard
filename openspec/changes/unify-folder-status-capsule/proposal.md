## Why

Change 2 of the four-way directory-card split established in
`openspec/changes/archive/2026-08-09-add-folder-actions-menu/design.md` (decision **D2**).
Change 1 landed the folder actions menu; the tier-1 signal it was supposed to declutter is
still three separate elements.

The folder header carries **three unrelated counters** for one question — "does this folder
need me?":

1. `(723)` — a raw session count rendered next to the folder name. It answers no question a
   user asks; a large number is indistinguishable from a busy number.
2. `FolderNeedsYouPill` — the purple attention signal.
3. `FolderStatusRollup` — working/idle counts, rendered **only when the folder is
   collapsed**. Expanding a folder to inspect it is exactly when the working/idle picture
   disappears. (The needs-you pill does render in both states — it is the working/idle half
   of the signal that vanishes.)

Three elements competing on one scan line dilute the pre-attentive purple signal that
attention-routing depends on — the same dilution change 1 attacked from the mutation side.

## What Changes

- **One severity-ordered status capsule** replaces `(723)`, `FolderNeedsYouPill` and
  `FolderStatusRollup`.
- **Severity order: needs-you > error > working > idle.** A human actively waiting outranks a
  crash: the crash is already over, the wait is not.
- **Segments are individual buttons**, each with a distinct `aria-label`
  ("4 sessions blocked on you — go to first"), not one ambiguous target. Clicking a segment
  stops propagation, expands the folder if collapsed, and jumps to the first session in that
  state **in the same ordered list the capsule counts** (the folder's own session order),
  reusing the folder list's existing reveal path so a filtered-out target degrades instead of
  silently doing nothing.
- **The trailing idle count is inert** — a fact, not a target.
- **The capsule renders in both collapse states**, fixing the collapsed-only rollup.
- **Empty segments do not render.** A folder with only idle sessions shows one inert count.
  Ended sessions are excluded before bucketing, so an all-ended folder shows no capsule —
  its size stays visible on the existing `N ended` disclosure row.
- **No new tokens.** Segment colours come from the existing **`--status-*`** session-status
  family (`needs-you` purple, `working` yellow, `idle` green, `error` red) — the same tokens
  the SessionCard dot uses, so the capsule and the card agree. Explicitly **not** the
  `--severity-*` triples: those are the toast/banner colour source of truth, they have no
  purple member, and their warning tier is orange where session `working` is yellow.

### Out of scope

- The tier-0 call-to-action banner (D4/D5/D6) → `add-folder-action-banner`.
- Slot-pill action buttons and the `SlotPill.actions` prop (D9/D10) →
  `move-slot-actions-to-menu`.
- Any change to how session status is *computed*. This change re-presents existing state.

## Capabilities

### New Capabilities

- `folder-status-capsule`: a single severity-ordered capsule that is the only liveness
  surface on the folder header, present in both collapse states, whose non-idle segments are
  navigation targets and whose idle segment is inert.

### Modified Capabilities

- `sidebar-folder-header`: the session count, needs-you pill and status rollup are replaced
  by one capsule, which sits between the folder-name region and the trailing action cluster.
- `folder-session-visual-hierarchy` (if it constrains the counters): the counter trio it
  describes collapses to one element.

### Removed Capabilities

- The collapsed-only rendering condition on the status rollup: superseded by the capsule's
  both-states requirement.

## Discipline Skills

`scenario-design` (severity-order matrix, empty-segment and both-collapse-state cases),
`review-code` (multi-component client change before commit).

## Impact

- **Code**: `packages/client/src/components/folder/FolderNeedsYouPill.tsx` and
  `FolderStatusRollup.tsx` (merged into the new capsule),
  `packages/client/src/lib/session/session-status-visuals.ts` (`countStatusRollup` →
  `countStatusCapsule`), `packages/client/src/components/session/SessionList.tsx` (header
  composition, session-count render site, and threading `errorSessionIds` /
  `retrySessionIds` / `noticeSessionIds` into the header — today they stop at the cards).
- **Test ids**: new `folder-status-capsule-<cwd>` and
  `folder-capsule-seg-{needs-you,working,error,idle}-<cwd>`. Existing needs-you / rollup ids
  are superseded — every consumer must move to a segment id.
- **Tests**: `FolderNeedsYouPill` / `FolderStatusRollup` unit tests, the `countStatusRollup`
  block in `session-status-visuals.test.ts`, plus any E2E anchoring on the raw `(N)` session
  count.
- **A11y**: per-segment `aria-label`s; the header row keeps `min-h-[44px] md:min-h-0`
  (WCAG 2.5.5); the inert idle segment must not be focusable.
- **Risk**: low-medium. Presentation-only, but it removes the most-looked-at element on the
  sidebar.
