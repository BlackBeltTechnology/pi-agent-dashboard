# Design: context-manager-blackhole-fork

## Context

Phase 2a of `unify-context-manager` (umbrella D1, D3, D12). It builds on
`context-manager-kernel` (flag K1, refusal K2, chassis K3, registry K4,
injection K5, `/context` K11). Upstream paths below are relative to the
pi-blackhole v0.5.15 tree (`git clone --branch v0.5.15
https://github.com/k0valik/pi-blackhole`, commit `0ce5ce5f`; MIT,
© 2026 k0valik). Facts were verified on pi 1.3.0 on 2026-10-21; "Spike" marks
a run of a throwaway extension with pi-ai's faux provider through `pi -p`.

- **Size.** 38,672 non-test LOC in `index.ts` (105) + `src/` (38,567), and 168 test files
  (154 under `tests/`, 14 under `src/`, mostly `src/pi-base/`; ~50.9k LOC). Upstream tests use
  vitest 5.0.5; this repo runs vitest 4.1.11 (`node_modules/vitest`).
- **Upstream compaction today.**
  - `src/om/compaction-trigger.ts:133/171/185` subscribes `agent_start`,
    `agent_end` and `turn_end`. The default `midRunCompaction` is `"off"`
    (`src/core/unified-config.ts:312`): compaction runs after the run, in
    `agent_end`, by polling `ctx.isIdle()` and calling the public
    `ctx.compact()`. `"pause"` calls `ctx.compact()` at `turn_end`, which
    aborts the run. `"resume"`, and every non-persisted session
    (`sessionManager.isPersisted() === false`), go through the private
    `compactInlineAtTurnBoundary` (`src/om/inline-compaction.ts:894`).
  - That file patches `AgentSession.prototype.compact` after locating the host
    module from stack frames, deep-imports pi's unexported `prepareCompaction`
    (:580-646), reads the private `session.settingsManager` (:1031), and
    shadows `abort`/`_disconnectFromAgent`/`_emit` during the call.
  - The summary is built in `session_before_compact`
    (`src/hooks/before-compact.ts:361`) from pi's `event.preparation`:
    `buildOwnCut` (:154) adjusts `preparation.firstKeptEntryId` per
    `tailBehavior`; `compile()`/`compileSegment()` (`src/core/summarize.ts:407/397`)
    render it; the result carries `details` with `om.folded` and
    `compactor: "blackhole"`.
  - `context` (`src/hooks/compaction-context.ts:13`) replays append-only
    segments with `projectAppendOnlyContext` (`src/core/compaction-chain.ts:560`).
- **pi 1.3.0 boundary API** (`dist/core/extensions/types.d.ts:753-835`):
  `turn_end` and `agent_before_settle` receive `BoundaryState { entries,
  continue, context: { contextEntries, contextMessages, llmMessages, … },
  outcome }` and may return `BoundaryResult { entries?, continue? }`. A
  `CompactionEntryDraft` is `{ type: "compaction", summary, firstKeptEntryId:
  string | null, details?, usage? }`. Public helpers: `findCutPoint`,
  `estimateTokens`, `calculateContextTokens`, `shouldCompact`,
  `getLatestCompactionEntry`, `buildSessionProjection`, `SettingsManager`
  (with `getCompactionSettings(model)`), all from the package root
  (`dist/index.d.ts:6,21,22`). Not exported: `prepareCompaction`
  (`dist/core/compaction/compaction.js:606`), which pi's own compaction calls
  (`dist/core/agent-session.js:2214,2504`). It is ~54 lines over private
  helpers (`findProjectedCutPoint` :552, `extractFileOperations` :16,
  `estimateProjectedContextTokens` :137, `getMessagesFromProjectedEntryForCompaction`,
  `extractFileOpsFromMessage`) and the root-exported `buildSessionProjection`.
  It returns `undefined` when the branch ends with a compaction or nothing
  can be summarized. pi is MIT-licensed.
  `event.context.contextEntries` are `ProjectedSessionEntry { sourceEntry,
  messages }` (`dist/core/session-manager.d.ts:140`), the finalized projection
  with context edits applied.
- **pi's compaction settings** resolve per field (`reserveTokens`,
  `keepRecentTokens`) from the model override, then the ordinary setting, then
  the default; invalid values throw when read (`docs/compaction.md`
  "Per-model overrides", `dist/core/settings-manager.js`
  `getCompactionSettings`).
- **Boundary merge** (`dist/core/extensions/runner.js:762-804`): each
  handler's returned `entries` replace the chain; `continue` is
  last-defined-wins (an `undefined` is ignored, a later `false` cancels); pi
  rebuilds `event.context` from the accumulated entries before the next
  handler; an invalid draft makes pi drop the whole boundary result.
- **Spike results** (throwaway extension, not committed; each is reproduced
  by a contract test in this change, B12).
  - A draft returned at `turn_end` of a turn with tool results applies to the
    run's next request (the request carries the compaction summary plus the
    kept entries; the original prompt is gone). `continue` is not needed.
  - A draft returned at `agent_before_settle` persists for the next prompt;
    `firstKeptEntryId: null` is accepted.
  - pi persists an ordinary `compaction` entry: `tokensBefore` computed by
    pi, `fromHook: true`, `details` kept, in the `parentId` chain.
  - **Neither path emits `session_compact`, nor `session_before_compact`.**
- **Dashboard coupling.**
  - The bridge forwards live `session_compact` (`packages/extension/src/bridge-handlers/forwarders.ts:35`,
    redacted at :553-568); the client draws the divider from it.
    `packages/shared/src/state-replay.ts:230-238` already synthesizes it on
    replay from persisted `compaction` entries (spec
    `compaction-boundary-replay`).
  - `packages/blackhole-plugin` reads `<agentDir>/pi-blackhole/pi-blackhole-config.json`
    and `<id>-pending.json`, and gates on `isPiExtensionInstalled("pi-blackhole")`
    (`src/server/index.ts:57,108`), backed by
    `packages/dashboard-plugin-runtime/src/server/installed-probe.ts`.
- **Subagents** use `SessionManager.inMemory` (`pi-dashboard-subagents`
  `extensions/agent.ts:1512`), so they are non-persisted sessions.
- **The bridge already drains entries pi announces nowhere:** `UsageDrain`
  (`packages/extension/src/usage-drain.ts`) keeps one cursor
  `{ sessionId, lastEntryId }` over the append-only `getEntries()`, drains at
  `turn_end`, `agent_settled`, `cache_warming_decision` and
  `session_shutdown`, re-baselines when `lastEntryId` vanishes, and baselines
  at register so replayed entries are never forwarded.
- **Another `context` subscriber:** `packages/image-fit-extension/src/extension.ts:70`
  resizes image blocks in `context` messages. It is not a context plane.

## Goals / Non-Goals

**Goals**
- Upstream blackhole behaviour (OM pipeline, VCC summary, `recall`, export)
  inside the context manager, with no private pi API.
- Compaction delivered through pi's boundary API, visible live in the dashboard.
- Lossless switching between upstream and the fork; blackhole-plugin unchanged
  except its installed check.
- The fork sheds the dropped modules.

**Non-Goals**
- Session index, `session_search`, `skill_manage` (2b); hermes distillers (3).
- Changing the summary builder, OM prompts, thresholds or defaults. The
  boundary path feeds the builder the same `preparation` object pi's own
  compaction would (B5), so summary inputs stay what upstream got from
  `ctx.compact()`.
- Retiring blackhole-plugin or renaming its config (6).
- Cross-session `context_search` over observations (later).

## Decisions

### B1: Fork from the git tag, keep upstream layout, carry the tests
- Source: tag `v0.5.15` (commit `0ce5ce5f`), not the npm tarball, which
  ships no tests. Before the copy, re-check `npm view pi-blackhole version`;
  a newer release is diffed and either adopted or recorded as skipped.
- Layout: `packages/context-manager/src/blackhole/<upstream path>` (e.g.
  `src/blackhole/om/agents/observer/agent.ts`), so upstream fixes can be
  cherry-picked by path. Tests go to `src/blackhole/__tests__/<upstream
  name>` and run in the package's vitest project.
- Provenance: `packages/context-manager/NOTICE` with the upstream MIT
  notice and pi's. Every `.ts` file under `src/blackhole/` (tests included)
  starts with one of three headers: `// Forked from pi-blackhole v0.5.15
  <upstream path> (MIT, © 2026 k0valik).` (copied, possibly modified),
  `// Copied from @earendil-works/pi-coding-agent 1.3.0 <dist path> (MIT).`
  (`pi-vendor/`, B5), or `// Part of the pi-blackhole fork; not upstream
  code.` (new files such as `om/unpaired.ts`). A test asserts it. Markdown
  files (`FORK.md`, `AGENTS.md`) are exempt. "Kept LOC" in `FORK.md` counts
  only files with the first header.
- Test port: vitest 5 → 4 differences are fixed in the tests, never by
  weakening an assertion. At least 95% of the upstream test files of kept
  modules are ported. Each one that is not is listed in `FORK.md` with a reason
  tied to a dropped module, or to a named vitest 4 incompatibility plus a
  follow-up.

### B2: Drop list (stated against the 0.5.15 base)

| Upstream path | LOC | Why |
|---|---:|---|
| `src/pi-base/**` | 8,417 | settings framework; config is read by B8's plain loader |
| `src/changelog/**` | 645 | migration notice |
| `src/om/status-bar.ts` | 385 | footer gauges; the dashboard shows state |
| `src/om/inline-compaction.ts` | 1,116 | the monkeypatch; `hasTrailingUnpairedToolCall` (:808) moves to `src/blackhole/om/unpaired.ts` |
| `src/core/settings.ts` | 10 | settings scaffold |
| TUI-only parts of `src/commands/**` | (counted at fork) | commands are re-registered as `/context` subcommands (B3) |
| tests of the above | — | `status-bar`, `inline-compaction`, `config-manager-modal`, `kitty-decode`, `number-field-inline-edit`, `migration-notice`, `tests/pi-base/**`, `src/pi-base/**/*.test.ts`, `src/changelog/changelog.test.ts` |

Kept although UI-adjacent: `src/om/clipboard.ts` (copy in `/context memory`)
and `src/om/key-matcher.ts` (used by `/context memory cleanup`). Umbrella D1's
`extension-root-migration.ts` and `project-memory-migration.ts` are hermes
files; blackhole 0.5.15 has none. About 10.6k LOC is dropped and about 28k
kept. `src/blackhole/FORK.md`
records the measured kept and dropped LOC per upstream directory; a test
recomputes the kept count and fails when `FORK.md` is stale.

### B3: Registration follows the kernel; nothing collides with upstream
- Load time, flag off: the fork registers nothing (kernel K1).
- Load time, flag on: no `pi.on` of its own. Every hook body binds as a chassis
  consumer (`owner: "blackhole"`), so in `refused` and `disabled` sessions
  nothing runs. This relies on kernel K1 computing the state, including K2's
  `refused`, at `session_start`: upstream registers its tools at load, so they
  are visible to `resolveState` before any fork `session_start` consumer
  (the OM `session_start`, the `--context-export` run) is dispatched.
- Tool `recall` goes through the kernel's tool lifecycle (K1): registered in
  `session_start` only when `active`, re-added to the active set on resume,
  removed on `active`→`refused`. It therefore never collides with upstream's
  `recall`.
- Both mechanisms are kernel extension points this change adds
  (`context-manager-runtime` delta): a consumer may hand the kernel a tool for
  the K1 lifecycle (K1 today names only `context_search`/`context_get`), and a
  `/context <name>` subcommand that the kernel dispatches with the state check.
- User-facing strings that name `/blackhole…` (e.g. `src/commands/pi-vcc.ts:114`,
  `src/hooks/before-compact.ts:73,946`, `src/om/compaction-trigger.ts:64`) are
  rewritten to the `/context` names.
- Commands are subcommands of the kernel's `/context` (registered at load
  when the flag is on): `/context compact` (upstream `/blackhole`),
  `/context memory` (`/blackhole-memory`), `/context memory off|on`
  (`/blackhole om-off|om-on`, but for the current session only: upstream
  persists `memory` to the global config, and the fork never writes config, so
  the subcommand points to the dashboard setting for a persistent change),
  `/context memory cleanup` (`/blackhole cleanup`), `/context recall` (`/blackhole-recall`), `/context export`
  (`/blackhole-export`). Dropped: `/blackhole configure|settings` (settings
  live in the dashboard plugin) and `/blackhole changelog` (module dropped).
  The headless
  flag is `--context-export` (upstream `--blackhole-export`, same grammar). A
  subcommand in a non-`active` session prints the state and does nothing.
  Reason: commands and flags are registered at load, before K2 can know
  whether upstream is installed, and the names must not collide with it.
- The upstream global map `Symbol.for("pi-blackhole:provider-streams")`
  (`index.ts:45`) becomes `Symbol.for("pi-dashboard.context-manager.blackhole.provider-streams.v1")`.

### B4: The chassis owns the compaction and context hooks
The kernel's chassis (K3) gains one subscription each for `turn_end`,
`agent_before_settle`, `context`, `session_before_compact`, `agent_start`,
`agent_end`, `agent_settled`, `session_compact` and `session_compact_failed`
(the last is in pi 1.3.0's `SessionEvent` union, so the upstream untyped
`onAny` cast at `src/hooks/compact-failed.ts:55` goes away). Composition:

| Hook | Rule |
|---|---|
| `turn_end`, `agent_before_settle` | each consumer receives the event with `entries` as returned so far; returned `entries` replace them; `continue` is last-defined-wins (an `undefined` is ignored), mirroring pi's own merge |
| `context` | each consumer receives the messages as returned so far; returned `messages` replace them |
| `session_before_compact` | consumers run in order; the first non-undefined result (`{ compaction }` or `{ cancel }`) wins and later consumers are not called; a consumer that throws is skipped and the next one is called |
| notifications (`agent_start`, `agent_end`, `agent_settled`, `session_compact`, `session_compact_failed`) | every consumer is called; results are ignored |

The fault isolation, replace-by-owner and exactly-once rules of K3 apply
unchanged. A throwing boundary consumer leaves `entries` and `continue` as
they were before it. `turn_start` is already a kernel hook (K3); the fork binds
its post-compaction consumer there.

The chassis cannot rebuild `event.context` between its consumers (pi's
`buildContext` is internal), so every chassis consumer of a boundary hook sees
the context pi built for the chassis' own handler. Rule: only one chassis
consumer may add a compaction draft (the fork's), it runs first (lowest
order), and it derives its inputs from the branch, not from drafts other
consumers add. A draft already present in the incoming `event.entries`
(another extension's) makes it return nothing.

### B5: Threshold compaction on the boundary API (umbrella D3)
- **Where.** `midRunCompaction: "off"` (default) → the compaction consumer
  runs at `agent_before_settle`. `"resume"` → it also runs at `turn_end`.
  `"pause"` → upstream behaviour unchanged for persisted sessions: public
  `ctx.compact()` at `turn_end` (aborts the run; pi announces it), plus the
  settle draft at end of run like every mode (upstream compacted at
  `agent_end` in every mode).
  Non-persisted sessions in any mode compact at `turn_end` and at
  `agent_before_settle` through the boundary draft, as upstream sent every
  non-persisted session to its turn-boundary path (`inlineMode = mode ===
  "resume" || nonPersisted`, `src/om/compaction-trigger.ts:214`). Both hooks
  run inside the run, before a parent can dispose the child (upstream issue
  #92; reproduced by a contract test).
- **When.** Upstream's gates are kept: `compaction` mode, skip-for-providers,
  `compactInFlight`, an aborted signal, the retry backoff
  (`midRunCompactionRetry`), and the threshold `autoCompactThreshold(config,
  ctx.model)` against `rawTokensSinceLastCompaction(branch)`. Added gates: no
  unpaired tool call (`hasTrailingUnpairedToolCall` over
  `event.context.contextMessages`, the model-visible messages, as upstream
  applied it to the session's active messages at
  `src/om/inline-compaction.ts:917`), at
  most one compaction per boundary, none at a boundary directly after the one
  that compacted, no settle draft when the run already compacted (a
  `turn_end` draft, a `"pause"` `ctx.compact()` — tracked by an in-memory
  per-run flag set when the fork calls it, since it may not be persisted yet —
  or pi's own compaction); `turn_end` drafts keep upstream's semantics (any
  boundary above the threshold, except right after a compacting one); no
  compaction draft already in the incoming `event.entries`, and a
  defined preparation (the vendored `prepareCompaction` returns `undefined`
  when the branch ends with a compaction or nothing can be summarized, as
  upstream's `isCompactionEligible` gate checked). "Produced" and "already
  compacted" are read from persisted entries (`getLatestCompactionEntry` on the
  branch, compared with the run's start), never from drafts returned earlier,
  so a draft pi did not persist suppresses nothing.
- **Preparation = pi's, vendored.** `src/blackhole/pi-vendor/prepare-compaction.ts`
  copies pi 1.3.0's `prepareCompaction` and its private helpers
  (`findProjectedCutPoint`, `extractFileOperations`,
  `estimateProjectedContextTokens`, `getMessagesFromProjectedEntryForCompaction`,
  `extractFileOpsFromMessage`) from `dist/core/compaction/compaction.js`, with
  the header `// Copied from @earendil-works/pi-coding-agent 1.3.0
  dist/core/compaction/compaction.js (MIT).` and an entry in `NOTICE`. It uses
  only the root-exported `buildSessionProjection` and types.
  - Input: `ctx.sessionManager.getBranch()` (pi's own `pathEntries`) and
    settings resolved by `src/blackhole/pi-vendor/compaction-settings.ts`, a
    copy of pi's per-field `getCompactionSettings` logic applied to the public
    `pi.getSettings()` ("a copy of the effective settings, global and project
    merged, with overrides", `types.d.ts:1286`; never a second
    `SettingsManager`). The parity test's model-override case pins that this
    equals what the session's own settings manager resolves. Invalid values throw as in pi; the consumer then
    skips with reason `invalid_settings`.
  - Output: the same `preparation` object (`firstKeptEntryId`,
    `messagesToSummarize`, `turnPrefixMessages`, `isSplitTurn`, `tokensBefore`,
    `previousSummary`, `fileOps`, `settings`) pi passes to
    `session_before_compact`.
  - **Drift detection:** a contract test compacts the same branches once
    through the boundary path and once through pi's real
    `session_before_compact` and requires an identical `preparation`
    (deep-equal), for: a plain branch, a context edit omitting a tool result, a
    previous compaction, a retain-none compaction, a split turn, and a model
    with a `keepRecentTokens` override. It runs on every pi bump; a failure
    means re-vendoring.
- **Summary.** The upstream builder runs unchanged on that `preparation`:
  `buildOwnCut` applies `tailBehavior` to `preparation.firstKeptEntryId`
  (`src/hooks/before-compact.ts:154`), and `compile()`/`compileSegment()`
  render the summary with the same `fileOps`, `tokensBefore` and settings. The
  only refactor is to extract the handler body into
  `buildCompactionResult({ preparation, branch, reason, signal, config })`,
  which returns either `{ compaction: { summary, firstKeptEntryId, details } }`
  or `{ cancel: true }` exactly as the hook did (`:1037`, `:1078`). On the
  boundary path `reason` is `"threshold"`; `{ cancel: true }` means no draft.
  "Compact everything" (upstream `firstKeptEntryId: ""`) maps to the entry's
  `firstKeptEntryId: null`; `details.coverage.firstKeptEntryId` stays `""` as
  upstream's validator requires a string.
- **Marker.** The draft's `details` gain `"context-manager.boundary": true`
  (upstream's fail-closed `isPiVccCompactionDetailsV2`, `src/details.ts:66`,
  checks named fields only, so the extra key is tolerated; the compatibility
  test pins it). It identifies compactions the fork
  produced through a draft; compactions pi announces never carry it.
- **Failure.** A throwing builder returns no draft, records upstream's retry
  backoff, writes `compaction.boundary.failed` with the error class to
  `debug.ndjson`, and logs one `[context-manager] compaction skipped: <class>`
  warning per session per cause (`builder_failed`, `invalid_settings`;
  likewise `subcommand_duplicate` in B3), so one cause cannot silence
  another (K11). The run continues uncompacted.
- **After a boundary compaction.** Upstream has three `session_compact`
  subscribers. For a boundary compaction the fork produced, their work runs
  once at the next `turn_start` or `agent_settled`, when the entry is
  persisted:
  - `src/hooks/cosmetic-output.ts:198`, the display-only copy of the newest
    dropped assistant text: kept.
  - `src/hooks/before-compact.ts:1096-1110`, the success notice (gated on
    `fromExtension` and `compactWasPiVcc`, delayed 500 ms) and the
    `compactWasPiVcc` reset: kept, gated on the `details` marker instead of
    `fromExtension`. Its `notifyMigrationReminder` call goes with
    `src/changelog/`.
  - `src/om/status-bar.ts:365`: dropped with the status bar.
  For compactions pi announces (`session_compact` fires; no marker), the
  upstream handlers run unchanged, so nothing runs twice.
- **Budget.** The threshold check at a boundary that does not compact: p95
  under 2 ms on a 2,000-entry branch (`rawTokensSinceLastCompaction` scans back
  only to the last compaction).

### B6: Manual and overflow compaction stay on `session_before_compact`
- pi's own threshold compaction, overflow recovery and `/compact` still emit
  `session_before_compact`; the consumer returns `buildCompactionResult`
  with the cut from `event.preparation` (unchanged upstream path).
- `/context compact` calls the public `ctx.compact()` with upstream's
  instruction marker. The private eligibility probe
  (`getCompactionIneligibility`, which needed `prepareCompaction`) is removed;
  pi's own refusal ("Nothing to compact", "Already compacted") is reported as
  information by the command's error handler, which upstream already
  recognises as benign.

### B7: `context` replay
`compaction-context.ts` is bound as the `context` consumer, unchanged:
append-only segments from the compaction chain are projected into the
messages pi sends. `image-fit-extension` keeps its own `context` handler. It
resizes image blocks for the provider and contributes no context content, so
it is outside the umbrella's one-owner goal, which this change amends to
name the hooks of context planes (hermes, blackhole, context-mode, kb). Order
between the two changes only wasted work (image-fit may resize an image the
projection later drops), not the messages sent.

### B8: Upstream-compatible state
- **Config.** A plain loader replaces `pi-base`'s config manager with the same
  sources and precedence (`src/core/unified-config.ts:789-830`):
  `<agentDir>/pi-blackhole/pi-blackhole-config.json`, then
  `<cwd>/.pi/pi-blackhole-config.json`, the legacy `pi-vcc-config.json` and
  `settings.json` fallbacks, and every `PI_BLACKHOLE_*` env override. Keys and
  defaults are unchanged. The fork never writes the config file (the plugin
  does): upstream's first-run defaults write and its legacy-migration
  write-back (`src/core/unified-config.ts:952,982,1004`) are not ported. An
  absent file means defaults, which blackhole-plugin already renders
  ("installed but never run"); legacy files are read, never rewritten.
  Consequences (documented): the plugin cannot tell "fork ran" from "never
  ran", and switching back to upstream lets upstream perform its own one-time
  writes then.
- **State.** `<agentDir>/pi-blackhole/<sessionId>-pending.json`,
  `pi-blackhole-cooldown.json`, `debug.ndjson`; session custom entries
  `om.observations.recorded|coverage|unanchored`, `om.reflections.recorded`,
  `om.observations.dropped`, `blackhole-pre-compaction-output`; custom
  messages `blackhole-export`, `blackhole-recall`,
  `blackhole-compaction-tail`; compaction `details` as upstream. All names and
  schemas are kept byte-compatible.
- **Consequence.** Upstream reading fork-written state and the fork reading
  upstream-written state are both tested (B11). blackhole-plugin's config,
  status and pending routes keep working unchanged.
- The stray `/tmp/pi-blackhole-debug.json` write (`src/hooks/before-compact.ts:115`)
  is dropped; `debug.ndjson` remains the debug sink.

### B9: Other private or fragile internals
- `src/om/agents/agent-context.ts:17-36` probes `createInitialSystemMessage`;
  pi 1.3.0 always has the transcript system message, so the legacy
  `AgentContext.systemPrompt` branch is removed.
- `src/om/provider-stream.ts:191-200` reads undici's global dispatcher through
  `Symbol.for("undici.globalDispatcher.1|2")` to apply
  `providerIdleTimeoutMs`. It is a Node internal, not pi's; it is kept, with a
  test that a missing dispatcher degrades to no idle timeout.
- No other private pi access remains. Public helpers (`findCutPoint`,
  `getLatestCompactionEntry`, `SettingsManager`, …) are imported from the
  package root. A test scans the non-test sources of `src/blackhole/`
  outside `pi-vendor/` and fails on any `@earendil-works/pi-coding-agent/dist/`
  import, a `prepareCompaction` import from pi, `AgentSession`,
  `prototype.compact`, `_emit`, `_disconnectFromAgent`, or a
  `.settingsManager` member access. `pi-vendor/` is checked separately: it
  may import only root-exported pi symbols.

### B10: The bridge announces unannounced compactions (alongside `UsageDrain`)
- **Usage drain unchanged.** `UsageDrain`'s cursor and drain points
  (`turn_end`, `agent_settled`, `cache_warming_decision`, `session_shutdown`;
  spec `token-stats-pipeline`) stay as they are.
- **Pending list.** Every drain also collects the `compaction` entries it
  passes into a per-session pending list. At `turn_start` the bridge
  additionally *peeks* past the cursor (read-only; the cursor does not move)
  and collects any new `compaction` entry. A draft returned at `turn_end` is
  committed after every `turn_end` handler, so its entry first shows up in
  this peek.
- **Flush.** The pending list is flushed at `turn_start` (before `turn_start`
  is forwarded) and at `agent_settled` (after that drain, before
  `agent_settled` is forwarded, and therefore before the follow-up drain of
  `mid-turn-prompt-queue` and the retry-chain close of
  `bridge-retry-observability`, which both run when the bridge handles
  `agent_settled`), and at `session_shutdown` (before the shutdown usage drain
  sends `session_unregister`). Each flushed entry not in the announced set produces one
  `session_compact`, in entry order, and its id joins the announced set; built like
  `packages/shared/src/state-replay.ts:230-238` (the entry's timestamp, no
  `reason`, no `willRetry`, no `compactionEntry`).
- **Announced set.** The bridge records `compactionEntry.id` from every real
  `session_compact` (before redaction), the id of every event it synthesizes,
  and the id of every `compaction` entry present when it replays on register,
  reconnect or fork (read from the same `getEntries()` snapshot the replay
  uses; the replayed events carry no id). The pending list and the announced
  set are per session and cleared on session change and shutdown. A reconnect does not move the
  usage cursor (existing rule), so without the replayed ids a compaction
  persisted just before a reconnect would be announced twice. This id set is
  the only compaction-specific dedupe; the `compaction-boundary-replay`
  requirement that forbade one is amended to allow exactly this.
- **Branches.** `getEntries()` is the whole append log, not the current
  branch (`dist/core/session-manager.js:1107`), so `/tree` navigation needs no
  anchor. A compaction is appended on the current branch during a run and is
  flushed at that run's next `turn_start`, `agent_settled` or
  `session_shutdown`, before any navigation can happen. A vanished
  cursor re-baselines (existing rule) and the peek starts from the new cursor.
- **Consequence (trade-off).** A boundary compaction carries no `reason` or
  `estimatedPostCompactionTokens`, so the client draws the divider without
  the badge, and the `compacting` latch (set by `session_before_compact`) is
  never shown for it. The compaction itself is synchronous at the boundary,
  so there is no in-progress state to show. A synthesized `session_compact`
  has no `willRetry`, which `bridge-retry-observability` treats as a
  non-retry compaction.
- **Budget:** p95 under 0.5 ms for a `turn_start` peek with no new entries on
  a 2,000-entry session.

### B11: blackhole-plugin recognises the fork
- The plugin's installed check becomes
  `isPiExtensionInstalled("pi-blackhole") || isPiExtensionInstalled("@blackbelt-technology/pi-dashboard-context-manager")`,
  in the status route and the settings gate. The manifest keeps
  `requires.piExtensions: ["pi-blackhole"]` for the install affordance.
- The plugin cannot see the per-cwd flag, so with the package installed and
  the flag off it shows settings that only upstream would use. Accepted: the
  config file is shared, and phase 6 replaces the plugin.
- **Trade-off:** the manifest keeps `requires.piExtensions: ["pi-blackhole"]`,
  so the Packages page shows that requirement as unmet for a fork-only user
  and offers to install pi-blackhole, which would make the kernel refuse the
  fork (K2). Accepted until phase 6; documented in `docs/context-manager.md`.
- A local-path install of the package (the `switch-extension-source`
  dogfooding path) must match by package name in `installedMatchesName`; a
  test pins it, and the probe is extended if it does not.

### B12: Verification strategy
- Ported upstream tests cover the kept modules (B1).
- New contract tests run a real pi 1.3.0 `AgentSession` (the repo's
  `node_modules` copy) with the faux provider (`fauxProvider()` from
  `@earendil-works/pi-ai`, registered with `pi.registerProvider`): mid-run and
  end-of-run compaction, the non-persisted path, the guard, cut parity,
  manual `/compact`, overflow, `context` replay, and the bridge synthesis.
  They reproduce every Spike fact in Context.
- The headless `--context-export` path re-verifies upstream's host
  assumptions on pi 1.3.0 (`session_start` awaited before exit,
  `ctx.shutdown()` behaviour, stdout takeover; `src/commands/blackhole-export.ts:275-341`).
- A compatibility test writes state with upstream (installed npm package
  loaded in a temp agent dir) and reads it with the fork, and the reverse.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| ~28k forked LOC to maintain | Upstream layout and per-file headers keep cherry-picks path-for-path; B1 re-checks upstream before forking; `FORK.md` counts what was shed |
| Vendored `prepareCompaction` drifts from pi | Deep-equal `preparation` test against pi's real `session_before_compact` on six branch shapes, run on every pi bump; re-vendor on failure (B5) |
| Boundary compactions show no badge or latch | Accepted consequence of generic synthesis (B10) |
| Fork-only users offered pi-blackhole by the manifest | Accepted until phase 6; documented (B11) |
| No `session_compact` for boundary compactions | B10 bridge synthesis; post-compaction work moved to `turn_start`/`agent_settled` (B5) |
| Commands renamed for flag-on users | Documented; only opt-in sessions are affected; upstream names stay with upstream |
| vitest 5 → 4 test port | Fix tests, never assertions; ≥95% ported; `FORK.md` lists exceptions with reasons |
| `"pause"` still aborts the run | Unchanged upstream semantics, public API; non-persisted sessions use the boundary draft (B5) |
| Stale or unused fork modules | `FORK.md` + kept-LOC test; `code-simplification` pass before commit |

## Migration Plan

1. Ship behind the kernel flag. With pi-blackhole installed, the kernel
   refuses and upstream keeps running.
2. To try the fork: uninstall pi-blackhole (or use a clean
   `PI_CODING_AGENT_DIR`), enable the flag. Existing pending files, cooldowns
   and `om.*` entries are read as they are.
3. **Rollback:** disable the flag and reinstall pi-blackhole; upstream reads
   the state the fork wrote.

## Open Questions

- Whether pi will emit `session_compact` for boundary compactions in a later
  release (to report upstream). B10's dedupe by entry id keeps the synthesis
  harmless if it does.
