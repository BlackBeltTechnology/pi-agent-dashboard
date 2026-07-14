## Context

File edits are hard to follow in the chat stream: many Edit/Write tool calls across many
turns, each a collapsed card. The dashboard already ships most of the machinery — `session-diff.ts`
(`enrichWithGitDiff`, `GET /api/session-diff`, per-file `gitDiff`), `useSessionDiff`, the
`FileDiffView` takeover (tree + `@git-diff-view/react`), the split editor pane
(`SplitWorkspaceContext` + `viewer-registry.tsx` with a `live-server` **virtual tab**
precedent), `OpenFileButton`, and a rich turn model on the client (`turnStats`, `turnCount`,
per-message `turnIndex`, `turnSeparator`). What is missing is a glanceable per-turn/per-session
change summary, per-file line counts, and a non-takeover home for the changed-files view.

See `proposal.md` for motivation and Resolved Decisions; `specs/` for requirements.

## Goals / Non-Goals

**Goals:**
- Deterministic per-turn inline change block (files + `+adds −dels` + open link), derived
  entirely client-side from Edit/Write events. No LLM, no network.
- Session-wide roll-up merged into the changed-files tree header (aggregate + per-file counts).
- Integrate the changed-files view into the split editor pane (Changes section over the
  project tree; per-file `diff` tabs); retain the takeover as a fallback route.
- Add optional per-file/aggregate line counts to the `session-diff` payload from
  `git diff --numstat HEAD`, backwards-compatible.

**Non-Goals:**
- Any LLM-generated prose summary of changes (explicitly excluded).
- New dependencies, protocol messages, or bridge changes.
- Editing/staging from the summary (read + open only).
- Reworking `@git-diff-view/react` rendering or the diff base-ref logic (`enrichWithVcsDiff`).

## Decisions

### D1 — Two data sources, intentionally distinct
Per-turn block = **event-derived** deltas ("what this turn did"). Roll-up = **git-net**
(`--numstat` vs baseline, "net state"). They differ when a line is added then removed; this is
correct and gets labeled, not reconciled. *Alternative rejected:* deriving both from git — loses
the per-turn attribution and needs a git call per turn.

### D2 — Per-turn line counts via `diff` (jsdiff), already a dependency
`diff@^8.0.3` is already in the client bundle (`EditToolRenderer` imports `createTwoFilesPatch`
— NOT `structuredPatch`; correcting the earlier provenance claim). `lineDelta.ts` adopts
`structuredPatch` (also a valid `diff` export) to count `+`/`−` hunk lines. It MUST handle
every edit shape the events actually carry (verified in `EditToolRenderer`): a single
`oldText`/`newText`, an `edits[]` array (sum the delta per op), and hashline ops; a Write
counts `content` lines as additions when there is no prior known content. *Alternatives
rejected:* naive `oldText.lines` vs `newText.lines` (over-counts unchanged inner lines);
counting only the simple `oldText`/`newText` case (drops `edits[]`/hashline turns); a new dep.

### D2a — Turn attribution: tool events have NO `turnIndex`
Verified: `turnIndex` is stamped only on the last **user** message at `stats_update`
(`event-reducer.ts:~1719`); Edit/Write enter `state.messages` as `role:"toolResult"` with
`turnIndex: undefined`, but DO retain `args` (`oldText`/`newText`/`edits`/`content`). So
`turnFileDeltas(messages)` cannot group by a message field — it walks the list and attributes
each tool event to the nearest **preceding** user message's turn (running `turnCount`). The
in-progress streaming turn (no `turnIndex` yet) groups under the current `turnCount`. This
O(n) attribution is memoized per turn (D-perf).

### D3 — `numstat` enrichment lives in `session-diff.ts`, optional fields
Add a `git diff --numstat HEAD` invocation (this is **new** work + a **new** parser: the
existing `enrichWithGitDiff` runs per-file `git.diffOr`, and `parseShortstat` in
`git-operations.ts` parses `--shortstat` summary lines, a **different** format — do NOT reuse
it). Parse `adds<TAB>dels<TAB>path`; binary rows report `-` → omit that file's counts and
exclude from totals. Extend `diff-types.ts`: `additions`/`deletions` on **`FileDiffEntry`**
(so `DiffFileTree`, which iterates `FileDiffEntry[]`, can read them) and
`totalAdditions`/`totalDeletions` on `SessionDiffResponse`, all **optional** (absent for
non-git / git-error / binary → old clients unaffected, request never fails). *Alternative
rejected:* counting +/− from each `gitDiff` string client-side — approximate for renames/binary,
recomputed every render.

### D4 — Integrate into the split pane, diff tabs use a virtual path
Per Resolved Decision #1: a new `ChangesRailSection` renders atop the editor pane's existing
project-tree rail, and a new `ViewerKind: "diff"` + `DiffViewer` opens a single file's diff as
a tab. **Two verified reducer constraints force the tab identity design:** (1) `openFile`
dedups by `path` alone (`editor-pane-state.ts:76`) and `EditorTabs` keys by `file.path`
(`EditorTabs.tsx:70`) → a `diff` tab and a `monaco` tab for the same real path would collide
(React duplicate-key + dedup swallow). (2) `VALID_VIEWERS` (`editor-pane-state.ts:142`) gates
persisted tabs. **Fixes:** diff tabs open under a **virtual path** `diff:<relPath>` (mirrors
the `live:<url>` precedent in `openLiveTarget`) so they never collide with the monaco tab of
the same file (satisfies contract #7); and `"diff"` is **added to `VALID_VIEWERS`** so a
persisted diff tab survives reload. `DiffViewer` strips the `diff:` prefix to resolve the file.
`openChanges()` opens the split and reveals the Changes section; rows call
`dispatch({ type: "openFile", path: \`diff:${relPath}\`, viewer: "diff" })`.

### D4a — Rail becomes a vertical stack
Today the rail is a single `<div>` wrapping only `EditorFileTree` (`EditorPane.tsx:~158`).
`ChangesRailSection` stacks **above** it in a vertical flex: a collapsible Changes section
(roll-up header + per-file rows) with its own scroll, then `EditorFileTree`, both honoring the
existing tree-visibility toggle.

### D5 — One shared `SessionDiffProvider`; no per-tab fetch
`ViewerProps` carries only `{cwd, path, kind, mimeType, size, line}` (`types.ts`) — it has NO
diff data, and `useSessionDiff` IS an HTTP fetch (`useSessionDiff.ts`). So a `DiffViewer` that
called `useSessionDiff` itself would fetch per tab. **Fix:** hoist a single
`SessionDiffProvider` (one `useSessionDiff(sessionId)` per session) into context; `DiffViewer`
(by stripped path), `ChangesRailSection`, and the fallback `FileDiffView` all read the same
cached `files[].gitDiff` + counts. "No fresh fetch" means **no per-file/per-tab fetch** — one
shared session-diff request backs every consumer, refreshed on new Edit/Write or manual
refresh. `DiffViewer` feeds `gitDiff` to `@git-diff-view/react` (already a dependency, same
renderer `DiffPanel` uses).

### D6 — `DiffFileTree` (numstat-fed) is the single enriched tree; per-turn block is separate
Add per-file `+adds −dels` + the aggregate header to `DiffFileTree` once, fed **only** by the
server `session-diff` numstat fields (via the D5 context). `ChangesRailSection` and the
retained `FileDiffView` takeover both consume it (DRY). The **per-turn `ChangeSummaryBlock`
is a distinct component** fed by client event-deltas (D2) — the two never share a data source,
so `DiffFileTree` has exactly one source (avoids the "two incompatible sources" trap a fresh
reviewer flagged).

### D7 — Takeover retained as `/session/:id/diff` fallback
Per Resolved Decision #2, the `App.tsx` `diffMatch` branch stays for deep-links and very narrow
mobile; the session-header button becomes a summary chip that calls `openChanges()` on desktop
and can fall back to the route where a split is impractical.

### D8 — On/off is a `DisplayPrefs` axis, not a bespoke setting
The per-turn block is gated by a new boolean `changeSummaryTable` on `DisplayPrefs`
(`display-prefs.ts`), reusing the entire existing global + per-session-override mechanism
(`mergeDisplayPrefs`, `PATCH /api/preferences/display`, `setSessionDisplayPrefs`, the ⚙ View
`ChatViewMenu`, the Settings-panel display section, the 3 `DISPLAY_PRESETS`). This is the
same pattern as `toolResults` / `toolGroupDefaultCollapsed`, so it inherits per-session
override, WS broadcast, connect-snapshot self-heal, and legacy backfill for free — no new
endpoint, no new control type, no standalone toggle button. **Only the per-turn
`ChangeSummaryBlock` is gated** (per the user decision); the Changes rail section, the
summary chip, and the `diff` viewer are NOT gated by this axis. Preset defaults follow the
visibility-axis convention: `simple` false, `standard` / `everything` true; legacy prefs
backfill to `true`. *Alternatives rejected:* a dedicated `preferences.json` field (duplicates
the override/broadcast plumbing); a localStorage flag (no per-session override, no cross-tab
sync — the legacy `show-debug-tools` mistake this capability already replaced).

## Risks / Trade-offs

- **Per-turn recompute cost over large event streams** → memoize the turn-attribution walk
  (D2a) + deltas per turn, keyed by the turn's tool-event identities; never recompute the
  whole session on each render. (Triggers the `performance-optimization` discipline.)
- **Fallback takeover renders outside `SplitWorkspaceProvider`** (`App.tsx` `diffMatch` branch)
  → accepted: it is an independent full-screen route, not shown alongside the pane; it reads
  the same `SessionDiffProvider` when mounted within its scope, else fetches once itself. No
  cross-coordination needed because the two are never visible simultaneously.
- **`SessionDiffProvider` staleness** (shared cache vs. live edits) → refresh on new Edit/Write
  events for the session + a manual refresh control (existing `FileDiffView` refresh reused).
- **Per-turn vs. net count skew reads as a bug** → explicit labels ("Changed this turn" vs.
  "Changes · net vs HEAD") and the `states.html` reconciliation case document it.
- **Non-git summed deltas drift from real net** (add+remove same line) → shown with a `summed`
  badge so the number is never mistaken for git-net.
- **Two tree consumers diverge** → mitigated by D6 (one `DiffFileTree`), guarded by the
  `code-simplification` discipline.
- **`--numstat` on huge diffs adds latency** → single call already bounded by the git timeout;
  fields are optional so a slow/failed call degrades to "no counts", not a failed request.

## Migration Plan

Additive, no data migration. Ship order: (1) shared optional fields → (2) server numstat
enrichment → (3) client `lineDelta` util + per-turn block → (4) `diff` viewer + rail section +
`openChanges()` + header chip, takeover route retained. Rollback = revert client wiring; the
optional payload fields are inert for old clients.

## Open Questions

- Preset defaults for `changeSummaryTable`: confirmed `simple` off / `standard` on /
  `everything` on (visibility-axis convention). Revisit if the per-turn block proves noisy
  enough to warrant off-by-default in `standard`.

- Should the per-turn block row open the file's `diff` tab (D4) or scroll-to-change within an
  already-open diff? Leaning: open/activate the `diff:<path>` tab and select the file in the
  section.
- `SessionDiffProvider` scope: wrap only the split content area, or high enough that the
  `/session/:id/diff` fallback route also consumes it (avoiding a duplicate fetch)? Leaning:
  wrap the session content area so both paths share it.
