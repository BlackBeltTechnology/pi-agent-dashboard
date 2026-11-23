# Design: narrow-branch-link-hit-area

## Context

See proposal.md — Why. Current state:

- The git row is `flex flex-wrap` (`packages/client/src/components/session/SessionCard.tsx:524`).
- The linked branch is `SafeLink` with `grow basis-[6ch] min-w-0 truncate` and `title` (`SessionCard.tsx:528`). `grow` makes the `<a>` absorb all free space, which is what pushes `PrSegment` / `GitDirtyPill` to the right edge, and it is also why the dead space is clickable.
- The non-link branch `<span>` carries the same sizing (`SessionCard.tsx:533`).
- `basis-[6ch]` drives the wrap decision: `flex-wrap` breaks lines on hypothetical main size, so trailing pills wrap only when pills + 6ch do not fit (spec "Narrow card keeps the pills visible").
- `SafeLink` renders an inert `<span>` for a blocked target (`packages/dashboard-plugin-runtime/src/safe-navigation.tsx:154-161`, pinned by `SessionCard.relayed-links.test.tsx:57`).

## Goals / Non-Goals

Goals: link box = icon + text (ellipsis included when truncated); focus ring stays visible; wrap / 6ch / ellipsis behaviour identical.

Non-goals: minimum touch-target padding on the link; changing the non-link branch; the folder-header link (`SessionCard.tsx:712`, no `grow`).

## Decisions

### D1 — Non-clipping flex wrapper owns the slot; the anchor owns the text

The branch slot becomes a wrapper `<span className="flex grow basis-[6ch] min-w-0">` with **no overflow rule**. The `SafeLink` inside it carries `min-w-0 truncate`, `focus-ring`, link colour, `hover:underline` and `title`, and wraps the icon + text.

- Width: the anchor is a flex item of the wrapper with no grow and basis auto, so it is exactly content-wide and shrinks (ellipsis) only when the wrapper is narrower than the text. Short text leaves the rest of the wrapper as non-link space.
- Wrap decision unchanged: the row keeps the same number of flex items (no extra `gap-x-1.5`), and the slot keeps `grow basis-[6ch] min-w-0`.
- Ellipsis is on the anchor, so the `…` is part of the link.
- Focus ring: the outline belongs to the anchor, and the anchor's own `overflow:hidden` does not clip its own outline. The wrapper has `overflow: visible`, so nothing new clips it.
- The 6ch floor is a property of the slot (wrapper), not of the link. A branch shorter than 6ch gives a link narrower than 6ch.

Alternatives rejected:
- **`max-w-fit` on the anchor + a `grow` spacer.** While both grow, a truncated branch gets only its share of the free space and truncates earlier. The spacer is also an extra flex item that adds a `gap-x-1.5` and can change the wrap point.
- **Wrapper takes `truncate` (overflow hidden), anchor inline inside it.** That clips the anchor's 2px-offset focus outline, and the wrapper, not the link, would own the `…`.
- **Drop `grow`, `ml-auto` on the first trailing pill.** Which pill comes first is conditional (PR may be absent), and dropping basis-driven growth changes the wrap decision.

### D2 — `title` stays on the link; the wrapper has none

The tooltip only appears over the clickable text. Dead space shows no branch tooltip. It falls through to the card root (`SessionCard.tsx:1361,1368`: `cursor-pointer`, `onClick` → `onSelect`), so a click there **selects the session** like any other non-interactive part of the card. That is the intended replacement behaviour.

### D3 — Non-link branch path is untouched

The `<span>` fallback (`SessionCard.tsx:533`) keeps its classes and structure; it has no click behaviour to bound. A blocked `gitBranchUrl` makes `SafeLink` render an inert `<span>` inside the wrapper: it is not clickable either way, so behaviour is unchanged.

## Risks / Trade-offs

- [Short branch names give a small target, e.g. `b` is about 20x14 px at 11px, below the 24x24 floor in WCAG 2.5.8] → Accepted: the user explicitly asked for text-only hit area. The WCAG 2.5.8 spacing exception applies: no other interactive target sits within the 24px circle (the dead space around the link is non-interactive card surface).
- [jsdom performs no layout, so geometry can't be tested in vitest] → L1 pins class-token placement (repo idiom: literal token lists); rendered geometry and hit-testing go to L3 Playwright, extending `tests/e2e/compact-session-card-header.spec.ts`.
- [Docker harness seeds no `gitBranchUrl`] → the L3 test extends the `Seed` type and `git_info_update` payload in `tests/e2e/compact-session-card-header.spec.ts` (~L33-76) with `gitBranchUrl`, and reuses its `**/api/git/status**` stub (~L203-207) for the dirty-pill case.
- [Existing F2 locates the branch by `[title=LONG_BRANCH]`, which is now the link (equal to the slot only while truncating)] → the slot's 6ch floor for a short branch gets its own L3 assertion on the wrapper.

## Migration Plan

None. Client-only CSS; rollback = revert the commit.
