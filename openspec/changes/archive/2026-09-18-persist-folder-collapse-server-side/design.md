## Context

See `proposal.md` — Why, for the defect and its mechanism.

Design-relevant current state:

- `SessionList.tsx` owns collapse as local `useState` seeded from
  `getCollapsedGroups()`, with a prune effect keyed on `[sessions.length]`
  that writes through to `localStorage`. The effect re-runs on **every** change
  in session count, not only the first snapshot after connect.
- Folder group keys are produced by `groupSessionsByDirectory` in
  `lib/session/session-grouping.ts`. The `cwd` field on a `DirectoryGroup` is
  a **display** path, deliberately not the session's raw `cwd`:
  pinned groups use the pin string verbatim ("so the header matches what the
  user pinned, not what some session happened to report"); worktree sessions
  group under `gitWorktree.mainPath` via `resolveSessionGroupPath`; stub
  groups use the `endedTotals` key. Internally the map is keyed by
  `pathKey(path, platform)`, but that canonical key is discarded before the
  group leaves the function.
- `pathKey` / `inferPlatform` / `resolveSessionGroupPath` already live in
  `packages/shared/src/session-group-path.ts` precisely so "the server keys its
  order map by the SAME resolved path the client reads". `inferPlatform`
  returns only `win32` or `linux` — **never `darwin`** — and `pathKey` folds
  case on every non-`linux` platform. Every existing server call site therefore
  uses `inferPlatform(<path samples>)`, not `process.platform`
  (`folder-head-poll.ts:81`, `directory-service.ts:1113`).
- Connect-time delivery is per-concern and unicast: `browser-gateway.ts`
  sends `pinned_dirs_updated`, `workspaces_updated`, `display_prefs_updated`
  to a newly connected client. There is no aggregate "preferences broadcast".
- `preferences-store.ts` stores `pinnedDirectories` and `workspaces[].folders`
  **realpath-resolved** (`canonicalize` = `safeRealpathSync(normalizePath(p))`),
  which is a different normalization from `pathKey`.
- The client does **not** do optimistic UI for server-owned sidebar state:
  `App.tsx:1834` — "optimistic UI is intentionally omitted: server is the
  single source of truth and broadcasts `workspaces_updated` for every
  mutation".
- The seek-to-card reveal expands a collapsed **workspace** through an
  ADD-ONLY setter (`onSetWorkspaceCollapsed(id, false)`) explicitly "never the
  toggle, so a re-seek can't re-collapse an already-open container"
  (`SessionList.tsx:1126-1131`). The folder leg of the same reveal instead
  calls `handleToggleCollapse(cwd)`, which is safe only because collapse is
  synchronous local state today. `resolveFoldAncestors` keys that call off
  `s.cwd`, not the resolved group path.
- The server already persists sibling state: `pinnedDirectories: string[]` and
  `workspaces[].collapsed` in `preferences.json`, with debounced atomic writes.
  Workspace mutations broadcast `workspaces_updated` from
  `browser-handlers/directory-handler.ts`, and only on an actual mutation.

## Goals / Non-Goals

**Goals:**

- Collapse state survives reload, cache clear, and a different browser.
- One canonical key per folder, regardless of which of the five sources the
  rendered group came from.
- Remove the prune without replacing it, and prevent a future prune from being
  re-introduced by encoding its absence in the spec.
- Reuse the workspace-collapse plumbing shape rather than inventing a parallel
  one.

**Non-Goals:**

- Per-device or per-browser collapse. Explicitly rejected — see Decision 2.
- Changing the *default* (a folder with no stored state stays expanded).
- Changing collapse animation, the collapsed-header slot rules, or the status
  rollup. Those requirements in `collapsible-groups` are untouched.
- Migrating any other localStorage-backed UI state (flow panels, sidebar width,
  tag area, DirectorySettings). They are unaffected and stay local.
- Reworking `groupSessionsByDirectory`'s display-path choice. The display path
  stays; we add the canonical key alongside it.

## Decisions

### Decision 1 — Delete the prune; store nothing to reconcile against

**Chosen:** remove `pruneStaleCollapsedGroups` from the live path entirely. No
replacement, no TTL, no cap.

*Rationale.* A prune is cache invalidation, and it needs the complete rendered
key-space to be correct. The current code does not have that key-space — it has
one of five sources — and any future refactor that adds a sixth source silently
re-breaks a prune that looks correct today. Meanwhile the cost of not pruning
is a short string per folder the user once collapsed. A stale key cannot
produce a wrong render, because a folder that is not rendered cannot be shown
collapsed. The invariant is asymmetric in our favour: a missing key degrades to
"expanded" (the documented default); a stale key degrades to nothing at all.

*Alternatives considered:*

- **Prune against the real rendered key-space.** Would work, but makes
  persistence depend on grouping output, which depends on snapshot timing —
  reintroducing the exact boot-order hazard (prune fires at connect, against a
  key-space the snapshot has not finished populating) that caused
  the wipe. Rejected: it fixes the instance, not the class.
- **TTL / last-N cap.** Decouples from grouping, but silently expires a folder
  a user collapsed months ago and never reopened. Unbounded-but-tiny beats
  bounded-but-surprising.
- **Prune only on explicit unpin / workspace-folder removal.** Tempting, but a
  folder can be collapsed while neither pinned nor in a workspace, so this
  covers a strict subset and adds coupling for partial benefit.

### Decision 2 — Server-side storage, global across devices

**Chosen:** `collapsedFolders: string[]` in `preferences.json`.

*Rationale.* Workspace collapse and pinned directories — the two states
immediately adjacent in the same sidebar — are already global server state.
Folder collapse being the odd one out is the reason the bug was invisible for
so long: the two halves of the sidebar have different persistence semantics and
different failure modes. Unifying them means one store, one broadcast pattern,
one set of tests. It also makes the state survive the failure modes localStorage
does not: private browsing, cache clear, a second browser, the Electron shell
vs the browser.

*Trade-off accepted:* collapsing a folder on a phone collapses it on the
desktop. This is already true of workspaces, so it is consistent rather than
novel — but it is a genuine behavioral change, not a free win, and is called out
as **BREAKING (storage location)** in the proposal.

*Alternatives considered:*

- **Keep localStorage, just fix the keying.** Smaller diff, no protocol change,
  no migration. Rejected by explicit user decision in favour of cross-device
  consistency — and it would leave the sidebar with two persistence regimes.
- **Server-side but namespaced per client/device id.** Gets both, at the cost of
  inventing a device identity concept the dashboard does not have. Rejected as
  speculative.

### Decision 3 — `pathKey()` is the single canonicalization authority, applied at the boundary

**Chosen:** every write and every read of a collapsed-folder key passes through
`pathKey(path, platform)` from `packages/shared/src/session-group-path.ts`, and
**both sides derive `platform` the same way — `inferPlatform(<path samples>)`,
never `process.platform`.** The client canonicalizes before sending; the server
canonicalizes again before storing and comparing.

*Grounding the server's samples.* `inferPlatform` takes path samples, and
`setFolderCollapsed` receives one path. It SHALL be called as
`inferPlatform([dirPath, ...existing collapsedFolders])` — the same
sample-the-paths-you-have shape as `directory-service.ts:1113`. For any POSIX
path this returns `linux` on both sides regardless of host OS, which is exactly
the agreement the key requires.

*Rationale.* This is the actual root cause — the storage move alone does not fix
it. Today the toggle writes a display path (pin string, worktree `mainPath`)
while every comparison uses a raw session `cwd`, with no normalization on either
side. Relocating an un-normalized key to the server just relocates Leak A.
Canonicalizing on both sides is deliberately redundant: the client needs it to
look up "is *this rendered group* collapsed", and the server cannot trust a
client-supplied path.

**The `platform` argument is the trap, and getting it wrong silently reproduces
the bug.** `inferPlatform` can only return `win32` or `linux`; it never returns
`darwin`. `pathKey` folds case on every non-`linux` platform. So a server that
passed its own `process.platform` would lowercase every key on macOS, while the
client — which must infer, and infers `linux` for any POSIX path — preserves
case. `/Users/...` contains uppercase, so on macOS *every* key would diverge and
collapse would silently never persist: the same observable symptom this change
exists to fix, relocated to the server. The server therefore SHALL call
`inferPlatform(<path samples>)` exactly as `folder-head-poll.ts:81` and
`directory-service.ts:1113` already do. `process.platform` is forbidden on this
path.

Case folding on macOS is consequently *not* applied (both sides agree on
`linux` semantics for POSIX paths). That is a deliberate consistency choice:
agreeing beats being individually clever, and it matches how every other
shared-key consumer in the repo already behaves. The spec delta therefore does
NOT promise case-insensitive matching on macOS — only separator normalization,
plus case folding on Windows.

**Stated assumption:** `inferPlatform` returns on the first sample matching
either rule, so client and server agree only while the paths they sample come
from one host's platform. That holds for every deployment this dashboard
supports (server and sessions share a filesystem). A mixed win32/POSIX path set
would let the two sides infer differently, and `normalizePath` mangles a POSIX
path under `win32` — out of scope here, but the assumption is now written down
rather than implied.

*Alternatives considered:*

- **Canonicalize only on the server.** The client still has to answer "is this
  group collapsed" per render against a server-supplied set, so it needs the
  canonical form locally anyway.
- **Reuse `canonicalize()` (realpath) from `preferences-store.ts` for symmetry
  with `pinnedDirectories`.** Rejected: the client cannot resolve symlinks, so
  a realpath-keyed store could never be matched at render time — the exact
  client/server key divergence of F1 in another costume. **Invariant to hold:**
  `collapsedFolders` is `pathKey`-folded and MUST NOT be realpath-normalized on
  load, unlike the `pinnedDirectories` entries beside it in the same file
  (`preferences-store.ts:322` re-realpaths pins on load; `collapsedFolders`
  must not join that pass).
- **Have `groupSessionsByDirectory` return the canonical key on
  `DirectoryGroup`.** Attractive and arguably the cleaner long-term shape — the
  key is computed and then thrown away. Deferred: it touches every grouping
  consumer and widens the blast radius beyond this fix. Call
  `pathKey(group.cwd)` at the two collapse call sites instead.

### Decision 4 — Mirror `set_workspace_collapsed` exactly

**Chosen:** `set_folder_collapsed { path, collapsed }` handled beside
`set_workspace_collapsed` in `browser-gateway.ts`, with a store method
returning `true` only on real mutation, and a broadcast emitted only on that
`true` — matching the documented "broadcast only on actual mutation" rule in
`directory-handler.ts`. The field is `path`, not `cwd`, matching the
folder-addressed siblings (`add_workspace_folders`, `remove_workspace_folder`,
`reorder_workspace_folders`, `move_folder_to_workspace`).

**Frame class matters.** `frameClassOf` in `browser-gateway.ts` must classify
`collapsed_folders_updated` as `cls: "state"` keyed by `msg.type`, beside
`pinned_dirs_updated` / `workspaces_updated`. The `default` branch returns
`cls: "transcript"`, which is subject to buffer-shedding — a shed collapse
update would be lost outright rather than coalesced. This is the failure mode
`fix-connect-snapshot-frame-loss` already addressed for the sibling messages.

**Connect-time delivery is part of this decision, not an afterthought.**
Mirroring only the mutation handler would leave a reloading client mounting
with `collapsedFolders: []` — every folder flashes expanded and never
corrects, because a broadcast fires only on mutation. `collapsed_folders_updated`
is therefore also unicast in the connect snapshot beside `pinned_dirs_updated`
and `workspaces_updated`, and **before `sessions_snapshot`** — the existing
burst already orders preferences ahead of sessions, and appending the new
message after the snapshot instead would reintroduce the expanded-flash this
decision exists to prevent. Without it the "Expand after reload" scenario is
unsatisfiable. The snapshot message is sent **unconditionally, including when
the array is empty** — it doubles as the "initial state has arrived" signal the
migration in Decision 5 waits on.

*Rationale.* An unfamiliar shape here would be gratuitous; the adjacent feature
already solved idempotent-mutation-plus-broadcast. Following it means the
no-op-suppression and echo-ordering behaviour are inherited rather than
re-derived.

*Open sub-decision, resolved:* use a dedicated `collapsed_folders_updated`
broadcast rather than extending `workspaces_updated`. Folder collapse is not
workspace state, and overloading the workspace broadcast would make every
collapse toggle re-render workspace-derived memos. There is no aggregate
"preferences broadcast" to extend — the protocol is per-concern.

### Decision 6 — Set, never toggle; no optimistic mirror

**Chosen:** the protocol carries an explicit target state
(`set_folder_collapsed { path, collapsed }`), the client renders straight from
the server-supplied set with **no optimistic mirror**, and the reveal path
calls an ADD-ONLY expand (`onSetFolderCollapsed(path, false)`) rather than a
toggle.

*Rationale.* Once collapse state arrives asynchronously, a guarded toggle
(`if (collapsed.has(k)) toggle(k)`) is a read-modify-write race: a second seek
arriving before the echo re-inverts the folder shut. The workspace leg of the
same reveal already refuses the toggle for exactly this reason
(`SessionList.tsx:1126-1131`, "never the toggle, so a re-seek can't re-collapse
an already-open container"). Folder collapse now has the same async property,
so it inherits the same rule.

No optimistic mirror, because `App.tsx:1834` establishes the opposite
convention for server-owned sidebar state and Decision 4 says to mirror
`set_workspace_collapsed` *exactly*. Inventing an optimistic path here would
contradict both.

*Trade-off accepted, and it is a real regression:* a collapse toggle now costs
a WebSocket round-trip where today it is instant local state. On a local socket
this is sub-frame; on a remote/zrok tunnel it is perceptible. Accepted for
consistency with every sibling control in the same sidebar, which already pay
it. If it proves annoying in practice, the fix is to introduce an optimistic
mirror *for all of them at once* — not to special-case folders.

*Consequences to implement — every in-place expand call site, not just the one:*

- `resolveFoldAncestors` must key off the resolved group path
  (`resolveSessionGroupPath`), not `s.cwd`, or a worktree session's reveal
  expands a key no rendered group owns.
- `seekToFolderOpenSpec` (`SessionList.tsx:1197`) performs the same
  guarded-toggle on a raw `cwd` and gets the same treatment.
- `FolderSpawnButtons`' in-place expand (`onSpawnSession` / `onSpawnWorktree`)
  also calls the toggle; it becomes an ADD-ONLY expand too.
- `EndedSubgroupCard`'s standalone-render fallback (`SessionList.tsx:1649`,
  the no-reveal-wiring branch of `onActivate`) is the fourth guarded-toggle
  site and gets the same treatment.
- `isFolderCollapsed` must look up the canonical key, not the raw `cwd`. Its
  existing filter-override (forced-expanded while a search/tag filter is
  active) is unchanged and out of scope — the "toggle while filtered, see it
  flip when the filter clears" behaviour is pre-existing, not introduced here.
- The reveal's completion-signal effect, today keyed to `[workspaces]`, must
  also observe the collapsed-folders echo, or an async folder expand falls
  through to the 5s timeout toast.

*Consequence accepted:* spawning into a collapsed folder now expands it one
round-trip later rather than in the same frame. Same trade as the toggle above.

*Spec consequence:* `session-card-seek` currently **mandates** the shape this
decision replaces — "Folder ancestor SHALL be `session.cwd`; when collapsed it
SHALL be expanded via the collapsed-groups mutator (`dashboard:collapsedGroups`),
which SHALL be invoked only when the folder is collapsed (it is a toggle)"
(`openspec/specs/session-card-seek/spec.md:55-57`). That requirement is
modified by this change; a delta spec for `session-card-seek` is required, not
optional.

### Decision 5 — One-shot, idempotent localStorage migration

**Chosen:** the migration runs **after** the connect snapshot has delivered the
server's current `collapsedFolders`, canonicalizes the legacy entries, and
sends `set_folder_collapsed` **only for keys not already in the known set**.
`removeItem` fires once the client's known set (the snapshot, plus any
subsequent echo) contains **every** canonicalized legacy key. If the socket
drops first, the local key survives and the migration retries on the next load.

*Why send-only-what-is-missing is load-bearing, not an optimization.* The store
broadcasts only on a real mutation. If the migration sent a key the server
already had, that call would return `false`, emit nothing, and a migration
waiting on an echo would **hang forever and never clear the legacy key**.
Sending only keys known to be absent makes every send a guaranteed mutation,
hence a guaranteed echo. The completion test is monotone — "is every legacy key
now present in the latest known set" — so it is also correct when a second tab
wins the race and *its* broadcast is what satisfies the condition.

*Rationale.* Users have real collapse state today. Silently dropping it would
present as "the fix reset my sidebar". N legacy folders cost N messages; the
set is user-sized (tens at most), so no bulk message is introduced.

*Why not the `show-debug-tools` shape verbatim:* that migration reads state
with a GET, then `await`s an HTTP `PATCH` response before `removeItem`
(`App.tsx:1120-1143`). Its safety comes from that awaited round-trip. The
WebSocket `send` used here is fire-and-forget into an outbox that can **expire**
(`App.tsx:373`), so a `removeItem` straight after `send` can permanently delete
the legacy set on a flaky connection. The echo-confirmed variant above restores
the awaited-acknowledgement property over a transport that does not offer one.
The GET-first half maps to "wait for the connect snapshot" and is what makes
the merge a **union** rather than a blind overwrite: without it, a stale tab
would re-collapse folders the user deliberately expanded on the new build.

*Deduplication:* two legacy entries differing only in spelling fold to one key
under `pathKey`. Harmless (the store is a set), asserted in the migration test.

*Termination backstop.* The completion test assumes the client's canonical form
equals the server's. If that ever fails (see the stated assumption in Decision
3), the condition would never be satisfied and the migration would re-send on
every load forever — with no prune to clean up the orphans it creates
(Decision 1). The migration therefore counts its attempts in the same
localStorage record and **drops the legacy key after 10 loads regardless**,
logging once. Bounded loss of a stale collapse set beats an unbounded write
loop; 10 is deliberately generous — preserving the user's real collapse set
outranks closing the bad-state window quickly, since the failure it guards is
hypothetical (it requires the Decision 3 platform assumption to break) while
the data loss would be certain.

*Caveat accepted:* by the time a user reloads with the new build, the prune may
already have emptied their localStorage — so the migration will frequently
carry nothing. It is insurance, not a guarantee.

## Risks / Trade-offs

- **Cross-device collapse surprises a user who wanted per-device state** →
  Called out as BREAKING in the proposal; matches existing workspace behaviour,
  so the sidebar is at least internally consistent. Revisit only on real
  feedback, not speculatively.
- **Collapse toggle now costs a WebSocket round-trip** → Accepted, not
  mitigated by an optimistic mirror; see Decision 6 for why that would
  contradict the established convention. A dropped socket degrades to "the
  toggle did not stick", never to a wipe.
- **`seekToFolderOpenSpec`'s focus retry is bounded at 20×100ms** → an async
  folder expand now consumes part of that budget; on a slow link the focus step
  can silently give up where it previously could not. Not re-tuned here;
  flagged so a failure is recognised rather than re-diagnosed.
- **`pathKey` canonicalization changes which folders are considered the same** →
  Two entries that formerly differed only by separator/case now collapse to one
  key. That is the intended fix, but it means migrated legacy entries can
  deduplicate. Harmless (a set), but assert it in the migration test.
- **A future contributor re-adds a prune "to clean up"** → Encode the absence
  in the spec: the `collapsible-groups` delta removes the prune scenario and
  states that stale entries are retained deliberately, so the spec contradicts
  the instinct.
- **The reload symptom survives the fix** → Would indicate a second independent
  wipe path that this analysis missed. Mitigation: the verification step is
  "watch `preferences.json` across a reload", which distinguishes
  "never written" from "written then cleared".

## Migration Plan

1. Ship server + shared first (additive: new message, new preference key,
   absent-in-legacy-file → `[]`). Old clients ignore both; no behavior change.
2. Ship the client: read from broadcast, delete the prune, run the one-shot
   localStorage → server migration, then `removeItem`.
3. Rollback: revert the client only. The server keeps writing
   `collapsedFolders`, which a reverted client ignores; users fall back to the
   old localStorage behavior. **This is strictly worse than the status quo for
   one group** — a plain-checkout user with no worktrees, pins, or ended-only
   folders has *working* localStorage persistence today (the prune only drops
   keys absent from `sessions.map(s => s.cwd)`), and the migration has since
   deleted their local key, so a reverted client finds nothing and they lose
   their collapse set once. That cost is accepted because the collapse set is
   cheap to re-create by hand and rollback is an exceptional path; it is NOT
   the "no data loss" claim an earlier draft of this plan made.
4. No data migration on the server. A `preferences.json` without
   `collapsedFolders` is valid and reads as `[]`.

## Open Questions

- Should a folder that is deleted from disk have its collapse entry removed on
  an explicit user "forget this folder" action? Deferrable: it changes no spec,
  no approach, and no task here, and the entry is inert until such an action
  exists.
