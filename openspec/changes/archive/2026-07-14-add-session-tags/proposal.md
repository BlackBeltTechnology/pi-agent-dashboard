## Why

The session list has no way to group sessions by *kind of work*. A user juggling many
sessions across folders cannot answer "show me my bugfix sessions" or "which sessions are
feature work vs docs." Folder + free-text search + Active-only already exist, but none of
them capture the user's own mental classification of a session. A thin, manual labeling
layer closes that gap without re-architecting the three typed classification fields that
already exist (`source`, `kind`, `openspecPhase`).

## What Changes

- Add a user-owned, free-form `tags: string[]` to each session, persisted in the existing
  `.meta.json` sidecar (`SessionMeta.tags`) and mirrored onto the broadcast
  `DashboardSession.tags`.
- Add a `set_session_tags { sessionId, tags }` browser-protocol message; the server merges
  via `mergeSessionMeta` and rebroadcasts (same write→broadcast path as `hidden`/`name`).
- Session card / detail header renders a chip strip: editable user chips (with a remove ✕)
  plus an "+ tag" affordance opening a free-form input with **autocomplete over the union
  of all existing tags** (self-healing vocabulary; new tags allowed).
- **Colorized tags (auto-hue, zero storage).** Each user tag renders a color from a fixed
  dark-tuned palette (indigo/blue/green/amber/rose/violet/teal/orange/slate), assigned
  purely by hashing the tag name (`hash(tag) % palette.length`). Stable hue per name, no
  user effort, nothing extra persisted — the color is a pure render function of the tag
  string, computed identically on every surface. No manual override. Execution chips stay
  uncolored (dashed/muted) to preserve the user-vs-derived distinction.
- Sidebar filter row gains a tag chip-filter group, **AND-composed** with the existing
  folder + session-search + Active-only chain. Within the tag group, multiple selections
  **OR-compose** (see Open Decisions).
- **Execution/phase chips are a read-only VIEW, not new storage.** The existing
  `openspecPhase` (`proposal`/`apply`/…) renders as dashed, locked, pickable filter chips in
  a separate group. (`kind` is excluded — automation sessions are filtered out pre-pipeline,
  so a `kind` chip could not function; see design D4.) Zero new derivation, zero mid-run
  skill emission — this is the discipline that keeps the change small.

Mockups (dark-theme tokens, verified in browser):
- [`mockups/index.html`](mockups/index.html) — overview: the three surfaces (card chips,
  add-tag popover, sidebar filter with user vs. execution groups).
- [`mockups/card-states.html`](mockups/card-states.html) — tag-strip lifecycle: untagged /
  editing / tagged+exec / overflow (+N). Grounds Open Decision #1.
- [`mockups/filter-in-action.html`](mockups/filter-in-action.html) — selection → filtered
  list, with the OR-within-tags / AND-across-axes rule and empty/clear states. Grounds
  Open Decision #2.

## Open Decisions

Sensible defaults chosen; each is overridable during design/apply:

1. **Edit affordance location** — default: detail-panel header (cards are already dense;
   the mockup shows it on the card for illustration).
2. **Multi-tag composition** — default: OR within the tag group, then AND against
   folder/search/Active-only.
3. **Execution chips namespace** — default: a separate "Phase (read-only)" group, visually
   distinct (dashed + lock) so users can't try to edit derived values.
4. **Vocabulary** — default: free-form + autocomplete (no curated enum at personal scale).
**Decided:** Tag color is auto-derived from the tag name (deterministic hash → palette
index) — pure render function, zero storage, no manual override. A tag's color is therefore
consistent everywhere it appears for free, and `SessionMeta` gains only `tags: string[]`.

## Capabilities

### New Capabilities

- `session-tags`: user-owned, free-form tags on a session — persisted to `.meta.json`,
  edited via a card/detail chip UI with autocomplete, filterable in the sidebar, and
  displayed alongside read-only execution/phase chips derived from existing typed fields.

### Modified Capabilities

<!-- None. session-search / session-list-filters gain a tag axis, but that behavior is
     specified fresh under the new `session-tags` capability rather than mutating those
     specs' existing requirements. Revisit during specs phase if a delta is cleaner. -->

## Impact

- `packages/shared/src`: `session-meta.ts` (+`tags`), `types.ts`
  (+`DashboardSession.tags`), `browser-protocol.ts` (+`set_session_tags`).
- `packages/server`: message handler → `mergeSessionMeta` + rebroadcast.
- `packages/web` / `src/client`: tag chip components (edit), sidebar tag-filter group,
  extend the existing filter predicate's AND-chain.
- No migration: `tags` is optional; absent sidecars read as untagged. No breaking changes.

## Discipline Skills

- `component-architecture` — reusable chip + chip-filter components with a consistent prop
  interface (card, detail header, sidebar all share them).
- `accessibility-a11y` — chips are interactive (remove ✕, filter toggle); need keyboard
  operability, focus states, and ARIA labels.
