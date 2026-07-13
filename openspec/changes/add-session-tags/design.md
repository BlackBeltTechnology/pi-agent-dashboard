## Context

Sessions can be filtered by folder path and free-text search, but there is no
axis for the user's own classification of *what kind of work* a session is. The proposal
picks Option A — a thin, manual labeling layer riding entirely on patterns that already
exist:

- `SessionMeta` (`packages/shared/src/session-meta.ts`) is the precedented sidecar for
  dashboard-owned per-session state (`hidden`, `name`, `attachedProposal`,
  `processDrawerCollapsed`, …), read/merged via `mergeSessionMeta` + written atomically.
- The write→broadcast path already exists, but note its ACTUAL shape (verified, not the
  naive "handler calls mergeSessionMeta" model): `handleHideSession` does
  `sessionManager.update(id, { hidden })` + `broadcast session_updated` and returns — it
  does NOT write the sidecar synchronously. Persistence flows through the debounced
  `sessionManager.onChange` hook in `server.ts` (~L331), which calls
  `metaPersistence.save(sessionFile, {…})` performing a FULL `.meta.json` overwrite (not a
  merge) from an EXPLICIT field enumeration. Cold-start restore reads the sidecar back via
  `sessionFromMeta` in `session-scanner.ts` (~L57), also an explicit field enumeration.
  Both enumerations must gain a `tags` line or the field is silently dropped/wiped (the
  `goalId` comment at the save site states this rule verbatim).
- The sidebar filter chain lives in
  `packages/client/src/components/SessionList.tsx`: `workspaceFilter` + `sessionSearch` are
  applied INSIDE the render loop (~L565, ~L820), while `filterSessions` (~L372) is called
  `activeOnly: false` PERMANENTLY (active-first is now ranking, not a filter). There is no
  live "Active only" filter axis — the real composable axes are `workspaceFilter`,
  `sessionSearch`, and the `showHidden` toggle.
- Execution classification already exists as typed fields on `DashboardSession`:
  `openspecPhase` (`proposal`/`apply`/…) and `kind` (`automation`).

Mockups (`mockups/`) fix the visual contract: user chips solid + colorized + removable;
execution chips dashed + muted + read-only.

## Goals / Non-Goals

**Goals:**
- Add user-owned `tags: string[]` to a session, persisted in `.meta.json`, mirrored on the
  broadcast payload.
- Edit tags via a chip UI (add with autocomplete over all existing tags, remove via ✕).
- Filter the session list by tag, AND-composed with the existing folder + search axes
  (there is no live "Active only" filter axis — see Context); OR within the tag group.
- Colorize user tags deterministically from the tag name (zero storage).
- Surface existing `openspecPhase` as read-only pseudo-tag filter chips — a VIEW, not new
  storage. (`kind` excluded — see D4.)

**Non-Goals:**
- No new derivation of execution tags, no mid-run skill/flow tag emission. Phase chips
  render from fields that already arrive.
- No manual tag colors, no color persistence, no color-override map.
- No tag rename/merge management UI, no tag deletion across sessions, no curated
  vocabulary/enum. Free-form only.
- No change to `openspecPhase` / `kind` / `source` semantics — tags are additive.
- No server REST surface beyond the existing browser-WS gateway.

## Decisions

### D1 — Storage: one field on the existing sidecar, THREE enumeration sites
Add `tags?: string[]` to `SessionMeta` and mirror `tags?: string[]` on `DashboardSession`.
No migration: absent field reads as untagged (`[]`). Because the persistence save is a full
overwrite from an explicit enumeration, `tags` MUST be added at all three enumeration sites
or it is silently lost:
1. `server.ts` `sessionManager.onChange` → `metaPersistence.save({ …, tags: session.tags })`
   — without this the debounced save WIPES tags on the next write of any other field.
2. `session-scanner.ts` `sessionFromMeta` → `tags: meta.tags` — without this cold-start
   restore drops tags (R1 restart scenario fails).
3. The `DashboardSession` broadcast payload (covered by the type mirror).
Normalize on write — trim, lowercase, drop empties, dedupe, cap count/length (`MAX_TAGS = 12`,
`MAX_TAG_LEN = 32`) — so the stored array is canonical.

*Alternative:* a separate tags store keyed by session id. Rejected — `SessionMeta` is the
established home for exactly this kind of dashboard-owned per-session state; a second store
duplicates the read/save/broadcast plumbing for no gain.

### D2 — Write path: mirror the `hidden`/`goalId` in-memory-update pattern (NOT a sync merge)
New browser message `set_session_tags { sessionId, tags }`. Handler `handleSetSessionTags`
in `session-meta-handler.ts`: normalize, then `sessionManager.update(id, { tags })` +
`broadcast { session_updated, updates: { tags } }`. It does NOT call `mergeSessionMeta` —
that would double-write and diverge from `handleHideSession`. The `update` triggers
`onChange`, which persists via the debounced full-overwrite save (hence the D1 enumeration
requirement). This is byte-for-byte the shape of `handleHideSession`.

**Concurrency (accepted trade-off):** whole-array replace = last-write-wins, and the save is
debounced (~1 s). Two browser tabs editing the same session's tags can clobber each other
within the debounce window. Accepted: identical to every other `SessionMeta` field (`hidden`,
`name`, `goalId`), tags are not special, and the blast radius is a cosmetic label. Not worth
optimistic-concurrency machinery.

*Alternative:* granular `add_session_tag` / `remove_session_tag` messages. Rejected —
whole-array replace is simpler and idempotent; per-tag deltas would still race the same way.

### D3 — Colors: pure render function with a PINNED hash, no storage
`tagColor(tag): PaletteColor = TAG_PALETTE[fnv1a32(tag) % TAG_PALETTE.length]`. The hash
algorithm is pinned to **FNV-1a 32-bit** (offset basis `0x811c9dc5`, prime `0x01000193`,
over the normalized lowercase UTF-8 bytes) with **unsigned 32-bit wraparound on every step**
— in JS: `h = Math.imul(h ^ byte, 0x01000193) >>> 0` (a plain `h * prime` overflows past
2^53 and corrupts the hash for longer strings; `Math.imul` + `>>> 0` is mandatory, not
cosmetic). This makes "computed identically everywhere" (R4) enforceable and gives unit
tests a concrete oracle. `TAG_PALETTE` is the 9-entry
dark-tuned set from `mockups/_tokens.css`. Pure helper + exported palette in
`packages/shared` (server, tests, client all agree).

*Alternative:* an unpinned `hash()` (djb2, native, etc.). Rejected — two implementations
would color the same tag differently and the tests would have no expected value.
*Alternative:* per-tag color override stored in a folder/global map. Rejected by the user —
auto-hue is zero-storage and consistent-by-construction.

### D4 — Filter: two SEPARATE selection sets, applied at the render-loop stage
User tags and phase pseudo-tags must NOT share one `Set<string>` — a user tag named `apply`
and `openspecPhase === "apply"` would be indistinguishable. Use two states in
`SessionList.tsx`: `selectedTags: Set<string>` (matched against `session.tags`) and
`selectedPhases: Set<string>` (matched against `session.openspecPhase` ONLY).
Each axis: empty = inert; non-empty = pass when the session's value intersects the set
(OR within the axis). Both axes AND with each other and with the existing
`workspaceFilter` + `sessionSearch` axes.

**Phase chips = `openspecPhase` only. `kind` is EXCLUDED.** `kind` has one value
(`"automation"`), it is a session classification not a phase, and — decisively — automation
sessions are stripped from the list by `filterSessions` (session-grouping.ts:261) BEFORE any
filter predicate runs, so an "automation" phase chip could only ever show zero results
unless `showHidden` is on. Grouping it with OpenSpec phases is both incoherent and
non-functional. Phase chips render the ~9 `OpenSpecPhase` values; sessions with
`openspecPhase == null` simply never match a phase chip (correct: they have no phase).

**Insertion is a full-audit problem, not a fixed site count.** `workspaceFilter`/
`sessionSearch` are woven through MANY gates in the 1300-line `SessionList` across three
folder tiers (pinned, unpinned, workspace) plus the ended-session partition. A first pass
named 3 sites; adversarial review found at least 7 (folder visibility for pinned/unpinned
*with* and *without* a workspace filter, workspace-tier folders which currently have NO
visibility gate, ended-session auto-expand, the "Show N ended" suppression row,
`isFolderCollapsed`, and the within-folder filter). Rather than enumerate a brittle,
provably-incomplete line-number list, the requirement is BEHAVIORAL: wherever
`workspaceFilter` or `sessionSearch` participates in a visibility/expand/suppression
decision, the tag+phase axes MUST participate identically, across ALL folder tiers. The
implementation task is an explicit audit: grep every `workspaceFilter`/`sessionSearch`
usage in `SessionList.tsx` and route `selectedTags`/`selectedPhases` through each. None go
in the `filteredSessions` useMemo (`activeOnly: false` + hidden/automation visibility only).
There is no "Active only" axis to AND with — it does not exist as a live filter.

**This filter integration is the recurring instability across doubt cycles** (see the note
at the end of this doc). **Decision: kept in this change as an explicit audit task** (6.2)
rather than split; tier-coverage tests (6.5) across pinned/unpinned/workspace are the safety
net for the multi-gate risk.

*Alternative:* AND within the tag group. Rejected as default — for a personal tool "show me
#feature or #bugfix" (widen) is the common intent; the other axes already narrow.

### D5 — Edit affordance: detail-header primary, card compact
The full editable strip lives in the session detail header. The card shows a compact,
read-only chip view with overflow collapsed to `+N`; "+ tag" on the card opens the detail /
inline popover. Keeps dense cards uncluttered (mockup `card-states.html`).

### D6 — Components: shared chip primitives
One `<TagChip>` (variant: `user` editable | `exec` read-only | `filter` selectable) and one
`<TagFilterGroup>`, reused across card, detail header, and sidebar. Colors + a11y
(keyboard-operable remove/toggle, ARIA labels) centralized here (triggers
`component-architecture` + `accessibility-a11y`).

## Risks / Trade-offs

- **Hash collisions on the 9-color palette** → two unrelated tags share a hue. Acceptable:
  color is a scannability aid, not an identifier; the tag text is always shown.
- **Free-form vocabulary fragmentation** (`bug` vs `bugfix`) → mitigated by autocomplete
  over the union of existing tags (self-healing), not eliminated. Out of scope to enforce.
- **Phase pseudo-tags** → derived from `openspecPhase` ONLY (not `kind`); rendered read-only +
  visually distinct so users don't expect to edit them.
- **Unbounded tags array** → mitigated by normalize-on-write caps (`MAX_TAGS = 12`,
  `MAX_TAG_LEN = 32`), enforced server-side in the handler before persist — a client sending
  10k tags or a 1 MB string is clamped before it reaches `.meta.json` or the broadcast.
- **Silent field wipe on full-overwrite save** → the `onChange` save enumerates fields and
  overwrites; forgetting `tags: session.tags` there wipes tags on the next unrelated save.
  Mitigated by making the D1 three-site enumeration an explicit task + a persistence test.
- **Autocomplete union cost** → the "all tags in use" set is derived by flattening every
  session's `tags`; memoize it (recompute only when the session list changes) rather than
  per-keystroke.

## Migration Plan

Additive, no migration. `tags` is optional everywhere; pre-existing sidecars read as
untagged. No data backfill, no version bump on `.meta.json`. Rollback = revert the code;
any `tags` already written are simply ignored by older code (unknown field, preserved by
`mergeSessionMeta`'s spread).

## Open Questions

- Overflow cap `N` on the card before `+N` collapse — pick a concrete number during apply
  (start at 3, tune against real cards).
- Whether phase pseudo-tags ship in v1 or land as a fast follow (the user-tag path is the
  core; phase chips are a read-only view that can trail). Default: ship together, they share
  the same filter component.

*Resolved during doubt-driven review:* normalizer caps pinned to `MAX_TAGS = 12`,
`MAX_TAG_LEN = 32`; hash pinned to FNV-1a 32-bit over `TextEncoder` UTF-8 bytes with
`Math.imul`+`>>>0` wraparound; "Active only" dropped (not a live axis); `kind` dropped from
phase chips (`openspecPhase` only).

## Doubt-cycle note (3 cycles run)

Storage, write path, persistence-enumeration, color, protocol, and chip components CONVERGED
(cycle 3 confirmed them clean). The **sidebar filter integration** kept surfacing substantive
findings across all three cycles (3 sites → 7+ gates → still tier-incomplete) because
`SessionList.tsx` is a genuinely complex multi-tier component. Per doubt-driven-review's
3-cycle rule, this is information about the artifact: the filter surface is the highest-risk
part. **Resolved (option B):** kept in-scope, but task 6.2 is framed as an AUDIT of every
`workspaceFilter`/`sessionSearch` gate across all folder tiers (not a fixed site list), and
task 6.5 asserts tier-coverage so an incomplete wiring fails a test rather than shipping.
