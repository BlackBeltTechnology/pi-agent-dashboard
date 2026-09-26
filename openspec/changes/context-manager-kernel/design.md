# Design: context-manager-kernel

## Context

Phase 1 of `unify-context-manager` (see its `design.md` D2, D5, D6 and the
Migration Plan). The facts below were verified on pi 0.87.1 and in this repo;
they are the premises of the decisions.

- **Prompt sections.** `before_agent_start` exposes mutable
  `systemPromptOptions.sections` (`Record<tag, text>`, rendered as XML-tagged
  sections and recorded as transcript deltas). Returning `systemPrompt` forces
  the whole prompt; later handlers see `systemPromptOptions.forceSystemPrompt`.
- **No cwd anchor.** pi 0.87.1 renders the working directory as a
  `<cwd>…</cwd>` section; the string `Current working directory:` no longer
  exists.
  - The bridge injector (`dashboard-context-injector.ts`) and kb-extension's
    doctrine (`insertFragment`) both miss that anchor and append their fragment
    to a forced `systemPrompt`.
  - The bridge forces the prompt on **every** dashboard turn. Under the
    dashboard, the forced-prompt path is therefore the normal path, not an
    edge case.
- **Tools.**
  - Registered tools are active by default (`includeAllExtensionTools`).
  - `pi.setActiveTools()` replaces `agent.state.tools`.
  - The agent loop resolves calls only against the active set: a call to an
    inactive tool gets an error result. **An inactive alias does not
    resolve**, as umbrella D6 had assumed it would (corrected here, K8).
- **Tool identity.** `pi.getAllTools()` returns each tool with `sourceInfo`
  (its extension's source). `recommended-extensions.ts` records
  `toolsRegistered` for pi-hermes-memory and context-mode; pi-blackhole
  (`recall`) is not in the manifest.
- **`/reload`.** It emits `session_shutdown`, invalidates the runner, re-runs
  every extension factory, and emits `session_start` again. `globalThis`
  survives.
- **The kb store.** Scores are negative and ascending-better. `SearchOpts`
  filters on one `root` only. `kb_search` searches every root of the per-cwd
  store with `searchOptsFromConfig(cfg, { overrides: { expandGraph: false, rerank: false } })`,
  after awaiting `reindexNow`, then runs `enrichHits`.
- **kb-extension's state** lives in closures: the guard (shared with
  `kb_guard_pause`), the advisory tool_call→tool_result map, `ReindexState`
  (store cache plus walk coalescing), the push mode and the nudge dedupe. Its
  first-contact nudge is ~540 characters plus the cwd length. Its doctrine is
  ~2.3 KB (READ) and ~4.9 KB (READ + WRITE).

## Goals / Non-Goals

**Goals**
- Flag off: identical to today (no tools, no handlers).
- Flag on and active: one owner of `session_start`, `turn_start`,
  `tool_call`, `tool_result` and `before_agent_start` for context work, in
  any load order and across `/reload`.
- A pinned tier that is byte-identical across turns while its inputs are
  unchanged, on both the sections path and the forced-prompt path.
- `context_search` / `context_get` over `docs` and `lessons`. The `docs`
  results are identical to `kb_search`.
- An abstention floor whose default is measured on held-out data.

**Non-Goals**
- Lesson format, triggers, cues and `lesson` (phase 3); session index,
  capture ingest and forks (phase 2); `exec` and web tap (phase 4); the plugin
  and recommended-extension entry (phase 6).
- Moving the bridge injector to `sections` (a follow-up).
- Changing the doctrine text or the `kb_*` tool descriptions (cutover).

## Decisions

### K1: Load-time flag, session-time state
- **Config.** `<cwd>/.pi/dashboard/context_manager.json` →
  `~/.pi/dashboard/context_manager.json` → default `{ "enabled": false }`.
  - The env var `PI_CONTEXT_MANAGER` overrides it: `1` = on, `0` = off, any
    other value = ignored, with one warning.
  - A malformed JSON layer counts as absent, with one `[context-manager]`
    warning.
  - Config and env warnings are emitted at load with `console.warn`, once
    per process. When the flag resolves off, nothing is registered, so no
    per-session handler exists to emit them.
  - This file **is** the umbrella's `contextManager.enabled` flag; the
    umbrella is amended to name it.
  - The package's data directory follows the same spelling:
    `<root>/.pi/dashboard/context_manager/` (`<root>` = git toplevel, K6).
    The config file stays per cwd, like kb's `knowledge_base.json`.
- **At load**, the flag is resolved for `process.cwd()`. When it is off, the
  factory registers **nothing**.
  - **Trade-off:** a process whose cwd differs from a session's cwd uses the
    load-time decision. Dashboard-spawned pi processes run in the session cwd;
    in-process sessions (subagents, `commit-draft-agent`) and resumed sessions
    inherit the process's decision.
- **When on at load,** the factory registers handlers and `/context`, and
  `session_start` computes the state from `ctx.cwd`:
  - `active`;
  - `refused` (K2);
  - `disabled` (the flag is off for `ctx.cwd`).

- **Tools are registered in `session_start`, and only when the state is
  `active`** (pi supports runtime registration; see its
  `examples/extensions/dynamic-tools.ts`). `disabled` and `refused` sessions
  therefore never carry them, and there is no register-then-remove delta in
  the transcript.
  - When `active`, both tools are also added to the active set if missing: on
    resume, pi restores the active tools from the transcript
    (`_restoreToolsFromTranscript`).
  - A later `active`→`refused` transition removes them with
    `pi.setActiveTools`.
- **The state only moves** `active` → `refused` (K2), and never back to
  `active` mid-session. A flag edit takes effect at the next session or
  `/reload`.
- **Assumed decisions** (the user said "go on" without choosing; revisit
  freely): a layered config with env override; kb-extension as a chassis
  consumer and provider (K4); aliases as the unchanged `kb_*` tools (K8).

### K2: Overlap refusal by package identity
- **Identity, not names.** pi-hermes-memory, pi-blackhole and context-mode
  are identified by exact package identity, never by tool name. Generic names
  such as `memory_search` collide: this host exposes one from another source.
- **Mechanism.** Settings files are not matched, because a listed package may
  have its extensions filtered out, and relative sources resolve against
  varying bases. Instead, `resolveState(sessionId)` inspects
  `pi.getAllTools()`: a tool belongs to an old package when its
  `sourceInfo.source` is `npm:<name>` (any version) or its `sourceInfo` path
  resolves upward to a package.json whose `name` is one of the three.
  Resolutions are cached per source path. **Budget:** a warm (cached) check
  p95 < 2 ms with 150 registered tools; the cold first check < 50 ms.
- **Premise:** all three packages register tools (verified for the installed
  versions). A hook-only extension would be invisible to this check.
- **When it runs.** Once per *turn epoch*: a counter bumped at
  `before_agent_start` and at `turn_start`, whichever handler (the kernel's or
  kb-extension's) reaches it first in that epoch. The guarantee covers the
  kernel's and kb-extension's handlers only. A package registered mid-epoch is
  seen at the next epoch.
- **When refused,** the kernel:
  - notifies once (`ctx.ui.notify`, a no-op in print mode, plus a
    `[context-manager]` log naming the package and the tool source);
  - removes its tools;
  - dispatches nothing.

  **From the refusing epoch on,** kb-extension runs its own hooks and
  behaviour matches today. Earlier turns of a runtime-refused session may keep
  inert artefacts in the transcript (the pinned section, an onboarding
  message, the tool declarations).
- **Dogfooding precondition.** This host's global settings list all three
  packages, so the kernel is always refused here. To try it, use a clean agent
  dir (`PI_CODING_AGENT_DIR=<tmp>`) or the docker harness.
- **Tests** use fixtures for each package (an npm source and a path source),
  plus negatives (`my-context-mode-ext`, a foreign `memory_search`).

### K3: Hook chassis
- One `pi.on(hook)` per hook: `session_start`, `turn_start`, `tool_call`,
  `tool_result`, `before_agent_start`, and `session_shutdown` (to close the
  kernel's own stores; kb-extension's ungated `closeKb` shutdown handler stays
  as-is).
- This subscription **is** the umbrella's "capture tap": the single
  `tool_result` subscription that phase 2's session ingest and phase 4's web
  tap register on. No data is captured in this phase.
- **Consumers** register as `(owner, hook, fn, order)`. Registering an owner
  **replaces** all of that owner's previous entries atomically, so re-running a
  factory on `/reload` never duplicates consumers.
- **Exactly-once rule.** The kernel dispatches only entries that were bound
  before the current event began. An owner that binds *during* an event
  handles that event itself. So whichever handler runs first, each event is
  handled exactly once.
- **Fault isolation:** a throwing consumer is skipped for that event, with
  one warning per consumer per session; the result and the other consumers are
  unaffected.
- **Composition.** `tool_result` follows pi's semantics for its four result
  fields (`content`, `details`, `isError`, `usage`): each returned field
  replaces the previous value, and the next consumer sees it. `tool_call`
  stops at the first `{ block }`.
- **Fail-open.** A throwing `tool_call` consumer does not block. That
  matches kb's guard, which is already fault-isolated (`guardNoteSafe`, X1).
- **Chain position (trade-off).** kb-extension's bodies now run at the
  kernel's position in pi's handler chain, not kb-extension's; their order
  relative to other extensions' handlers depends on load order.
- **Budget:** dispatch overhead p95 < 1 ms per event with five no-op
  consumers over 1,000 synthetic events.

### K4: kb-extension is a chassis consumer and a docs provider (inversion)
- **The registry** lives at
  `globalThis[Symbol.for("pi-dashboard.context-manager.v1")]`. The version is
  in the key, so a skewed pair simply sees no shared registry and runs
  independently: the kernel reports `docs` as `unavailable`, and kb-extension
  keeps its own hooks.
- **Slots are per session:** `slots: WeakMap<SessionManager, Slot>`, keyed
  by the `ctx.sessionManager` object (with its session id recorded for logs).
  In-process children that are disposed without `session_shutdown`
  (`commit-draft-agent` calls `session.dispose()` directly) therefore leave
  nothing reachable. kb-extension's own store handle in such children leaks
  today, independent of this change. A `Slot` holds:
  - `state`;
  - `consumers` (per owner, replace-by-owner, K3);
  - `providers["kb-extension"]`: `{ docsSearch, docsGet, docsNeighbors,
    pinned, messageItems }`.
- **Binding.** Each kb-extension instance binds its own closures into its own
  session's slot, at its `session_start` (a new handler that only binds, which
  is registration rather than context work) and lazily on any event whose slot
  lacks its entries (the K3 exactly-once rule applies).
  - In-process sessions (subagents, `commit-draft-agent`) therefore get their
    own slots and never replace the parent's consumers.
  - `session_shutdown` deletes the slot. `/reload` re-binds, and the lazy
    path covers SDK runs where `session_start` does not fire.
- **State.** The slot's state is set by the kernel's `session_start`, or
  resolved lazily by `resolveState` on the first event when `session_start`
  did not run. A missing kernel leaves no state, so kb-extension runs its own
  hooks.
- **Dispatch.** kb-extension's own subscriptions call
  `resolveState(sessionId)` per event and return immediately when it is
  `active`. The kernel then dispatches the same closures from the same slot.
  There is one guard, one advisory map, one `ReindexState` and one
  `kb_guard_pause` target per session, independent of load order.
- **Docs goes through kb-extension's own code.** `docsSearch` is the body of
  `kb_search` (freshness reindex, the same opts, `enrichHits`), returning raw
  hits for the kernel to render. It uses the same `ReindexState`, so there is
  no second connection to the docs DB.
- **Only `before_agent_start` changes shape** (doctrine and nudge delivery). Its doctrine body splits into:
  - `pinned()`: `buildDoctrineFragment` plus the legacy-seed check over
    `contextFiles`; returns `""` when seeded, `inject: off`, or the doctrine is
    unreadable;
  - `messageItems()`: the first-contact or migration nudge, once per
    session.

  kb-extension never touches `systemPrompt` while the kernel is active.
- The guard's reset set adds `context_search` and `context_get`, counted
  only while the session is `active`, so another package's tool of the same
  name cannot reset it.

### K5: Injection owner
- **Pinned block.**
  - The concatenation of the providers' `pinned()` output, prefixed by the
    sentinel line `── context-manager pinned ──`.
  - It is memoised on its inputs: the doctrine config, the doctrine file
    bytes, and the legacy-seed verdict.
  - Content classes: the doctrine (~2.3 KB READ, ~4.9 KB READ + WRITE; the
    same bytes kb-extension injects today) and, from phase 3, pinned lessons
    capped at ~2 KB. The umbrella's D2 "≤ ~2 KB" applies to the lessons class;
    it is amended to say so.
- **Empty block.** When every provider returns `""`, there is no block, no
  sentinel and no section.
- **Sections path.** When the prompt is not forced, the kernel sets
  `sections["context"]` to the block.
- **Forced path** (the normal dashboard path). When `forceSystemPrompt` is
  set on entry, the kernel returns `systemPrompt` with the block, wrapped
  exactly as pi renders a section (`<context>\n…\n</context>`), inserted
  before `── pi-dashboard session context ──` when present, otherwise
  appended.
  - Both the sentinel (idempotency) and the bridge delimiter (insertion
    point) are searched only **after the last `</cwd>`**, pi's rendered cwd
    section. Project context, where AGENTS.md rows may quote either literal
    verbatim, is rendered before it and can neither suppress nor misplace the
    block. A forced prompt with no `</cwd>` (from another extension) is
    handled by appending.
  - When the kernel runs before the bridge, it uses the sections path, and the
    bridge's forced copy already contains the rendered section.
  - Each handler order yields exactly one block and one bridge fragment, and
    is byte-stable across turns. A contract test runs both orders with the real
    `spliceContextFragment` on a pi-0.87-shaped prompt.
- **Per-turn message** (one `before_agent_start` `message`,
  `customType: "context-manager"`), with two item classes:
  - `onboarding` (the doctrine nudges): delivered whole, once per session,
    **outside** the cue budget, with `display: true`. "Once" is decided from
    the session's entries (an earlier `context-manager` message carrying the
    same nudge id), so `/reload` and resume never repeat it. There is no nudge
    when the doctrine file is unreadable, as today. They are instructions the user must answer,
    and truncating them would cut the non-interactive clause.
    - **Trade-off:** a message persists in the transcript (and on resume) as
      a custom message. Today the nudge is a one-turn system-prompt fragment.
  - `cue` (phase 3): at most 2 items / 600 characters, by priority (umbrella
    D5).

  No message is emitted when both classes are empty.

### K6: Scopes; one engine, one database per non-docs scope

| Scope | Store | Roots | Ingest |
|---|---|---|---|
| `docs` | kb-extension's per-cwd store, via `providers["kb-extension"]` | configured kb sources | kb-extension (unchanged) |
| `lessons` | `<root>/.pi/dashboard/context_manager/lessons.db` | `lessons:project` → `<root>/.pi/lessons/`, `lessons:global` → `~/.pi/agent/lessons/` | `indexSource` (markdown), K6.1 |
| `sessions` | registered, no store | — | phase 2 (D9) |
| `web` | registered, no store | — | phase 4 (D8) |

- `<root>` is the git toplevel of the session cwd (`git rev-parse
  --show-toplevel`), falling back to the cwd. Sessions in subdirectories share
  the repo's lessons, as umbrella D4 requires.
- `code` (listed in the umbrella's architecture) is not a phase-1 scope; it
  stays with kb's `docs` until a phase claims it.
- **Why separate databases:** `kb_search` searches every root of its store,
  and the store has no multi-root filter, so lessons roots there would leak into
  `kb_search`.
- **Overlap with docs sources.** A docs source may contain a lessons root;
  this repo lists `.pi` as a source, so `.pi/lessons/*.md` is also indexed as
  docs.
  - `kb_search` is unchanged: it returns whatever its configured sources hold,
    as it does for any `.pi` markdown today.
  - `context_search`'s `docs` scope drops hits under a lessons root, so a
    lesson appears only in `lessons` and never twice. It over-fetches
    (`limit × 2`) before filtering, so the page is not short.
  - **Trade-off:** a default (docs-only) call therefore does not return a
    lesson file that `kb_search` would return from a docs source. The
    lessons scope must be named. This is documented in the tool description. A separate file also means no write-lock contention and a
  one-directory rollback. The umbrella's "one index" is amended to "one engine,
  one DB per scope".
- **K6.1 Populating lessons.**
  - A scope is *configured* when at least one of its root directories exists.
  - The first search of a configured scope in a session runs `indexSource`
    over its roots (a create plus cold populate on the first ever run; an
    mtime/sha incremental walk afterwards).
  - A markdown `write`/`edit` under a lessons root triggers a debounced
    reindex through a kernel `tool_result` consumer.
  - **Read-after-write is strong.** A `lessons` search first awaits any
    pending or in-flight lessons reindex, as `kb_search` awaits its freshness
    reindex, so an immediate search sees the edit.
  - The default scope set is `docs` only in this phase. `lessons` is searched
    only when named, until phase 3 calibrates its floor, so fusion cannot
    evict docs hits from the default call. `sessions` and `web` are never
    configured.
  - Global lessons are indexed once per cwd (per `lessons.db`); they are
    small, so this is accepted.
  - `.pi/dashboard/context_manager/` is added to this repo's `.gitignore`
    (kb's own `.pi/dashboard/kb/` has the same per-repo pattern).
- A worktree indexes its own checkout of `.pi/lessons/`; git-common-dir
  identity matters only for untracked state (phase 3).

### K7: `context_search` and fusion
- **Parameters:**
  - `query`;
  - `scope?` (one or a list; default `docs` in this phase);
  - `limit?` (default 10);
  - `format?`: a free string with an in-body allowlist, as in `kb_search`
    (unknown → `condensed`, never throws);
  - `doc_type?` (passed to `docs`).
- **Empty query:** `(no query)` / `[]`, as `kb_search` does.
- **`docs`** returns `docsSearch`'s hits minus those under a lessons root.
  It is therefore the same code as `kb_search`, and the same results whenever
  no lesson file exists under a docs source.
- **Provider missing.** When the session has no docs provider (no
  kb-extension, or version skew), `docs` returns `(docs unavailable)`,
  never the abstention text.
- A single scope returns its ranking unchanged, plus a scope tag.
- Several scopes are fused with Reciprocal Rank Fusion (`k = 60`) over each
  scope's post-floor list, then truncated to `limit`. RRF uses ranks only.
  Ties go to `docs`, then to the lower within-scope rank.
- **Trade-off (documented):** parity with `kb_search` is guaranteed for
  `scope: "docs"` with its floor at 0. The default call (docs with the
  project floor) differs only by whole-call abstention (K9).

### K8: Aliases are the unchanged kb tools (corrects umbrella D6)
- pi does not execute inactive tools. The `kb_*` tools therefore stay
  **registered by kb-extension, active and unchanged** (description,
  parameters, behaviour) in this phase, whatever the kernel's state.
- Slimming them to deprecation descriptions happens at cutover (phase 6), when
  the kernel is the only mode.
- **Cost:** both tool pairs are in the prompt while the opt-in flag is on.

### K9: Abstention floor: off by default, calibrated per project
- **Rule: top hit only.** A scope abstains when its **first returned hit's**
  relevance (`r = −score`, kb's returned score including its proximity bonus)
  is below the scope floor. Otherwise its list is returned unchanged. No
  per-hit dropping, so lane interleaving, lead slots and order are untouched.
  When every requested scope abstains, the result is `(no confident match)` /
  `[]`.
- **Default `{ value: 0 }` everywhere.** BM25 scales depend on each corpus, so
  a value calibrated on one repo cannot ship as a global default.
- **Calibration is a per-project script** (`eval/calibrate-floor.ts`). By
  default it reports only. With `--write` it stores
  `retrieval.floor.docs = { value, norm }` in that project's
  `context_manager.json`, and only when the ship rule passes.
- **This change runs it for this repo in report mode.** It records the
  numbers in `measurements.md` and commits no floor; writing the config is
  the operator's choice.
- **Data:**
  - **Positives:** `packages/kb/eval/golden.markdown-intent.json` and
    `golden.source-intent.json`.
  - **Negatives:** `eval/negatives.in-domain.json` and
    `eval/negatives.off-domain.json`, at least 60 queries each, with no
    session content, so no PII.
    - They are written by a subagent from a different model family than the
      calibration author, given only the list of top-level packages.
    - An in-domain item is kept only if its key term has **no match in the
      docs kb index** (an FTS query against the store the scope searches).
      The committed eval files are excluded, so an item cannot match itself.
  - **Split:** each set is split into *select* and *verify* halves by a hash
    of the query text `q`.
- **Selection:** on the select halves, the highest floor, in the
  better-separating `norm` (`raw` or `per-term`), with which at most 2 queries
  per golden set lose their Recall@10 hit.
- **Ship rule (verify halves), else no floor is written:**
  - in-domain abstention of at least 50%;
  - at most 3 queries per golden set losing their Recall@10 hit;
  - P@1 and MRR on `golden.source-intent.json` (the `agents`-lane-heavy set)
    within 0.02 of floor 0.
- **Report:** `measurements.md` records the counts with n for every number,
  the chosen floor and norm, and the chunk count.
- **Drift:** `/context status` shows the calibration chunk count against the
  current count and flags growth above 25%, with a hint to re-run the script.
- `lessons` stays at 0 until phase 3 calibrates it on lesson queries.

### K10: `context_get`
- **Parameters:** `ref` (a path), `scope?` (`docs` | `lessons`, default
  `docs`), `section?`, `neighbors?` (a depth; when present, the result is the
  neighbours of `section`'s heading node if given, else of `ref`'s file node).
  A lesson path without `scope: "lessons"` is looked up in `docs`.
- There is no prefix parsing inside `ref`, so Windows drive paths are safe.
- `docs` delegates to `docsGet`/`docsNeighbors`; `lessons` delegates to
  `lessons.db`. Both use kb_get's `(+N more sections…)` marker.

### K11: Observability
- `[context-manager]` log lines are emitted:
  - once per session for the state and its reason or evidence;
  - once per consumer fault per session;
  - once per malformed config or env value;
  - once per `active`→`refused` transition.
- `/context status` prints the state, the scopes (configured, chunk counts,
  or `empty`), the consumers per hook with their owners, the floors with their
  drift indicator, and the registry version.
- `context_search` `details` carry per-scope hit counts, the floor outcome and
  latency.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Handler order: bridge, kb-extension, kernel | Per-event, per-session registry (K4); forced path anchored after `</cwd>` (K5); contract tests in every order |
| `/reload` stacking consumers | Replace-by-owner registration (K3), with a test that reloads twice |
| Old packages detected late | `sourceInfo` identity check once per turn epoch, before the kernel or kb-extension acts (K2) |
| First event handled twice or not at all | Exactly-once rule: an owner bound during an event handles it itself (K3) |
| Resumed sessions lose the new tools | Tools re-added at `session_start` when `active` (K1) |
| Child sessions disposed without shutdown | Slots in a `WeakMap` keyed by the session manager (K4) |
| Cannot dogfood on this host (old packages installed globally) | Clean `PI_CODING_AGENT_DIR` or the docker harness (K2) |
| Version skew between kernel and kb-extension | Versioned registry key; skew means independent operation, never double work (K4) |
| Two tool pairs in the prompt while the flag is on | Accepted for the opt-in phases; slimmed at cutover (K8) |
| Floor hurts recall, P@1 or drifts | Off by default; per-project calibration with a held-out ship rule (Recall@10, P@1, MRR); top-hit-only abstention; drift flag (K9) |
| Chassis latency | K3 budget test; phase 3 re-measures with the matcher |

## Migration Plan

1. Ship the package (peer `pi >=0.87.1`, the version the premises were
   verified on). Install it locally with the `switch-extension-source` skill.
2. Enable per project (`.pi/dashboard/context_manager.json`
   `{"enabled": true}`) or with `PI_CONTEXT_MANAGER=1`. The old packages must
   not be loaded (on this host, use a clean `PI_CODING_AGENT_DIR`).
3. **Rollback:** flag off, or remove the package. kb-extension resumes its
   hooks at the next session. Delete `<root>/.pi/dashboard/context_manager/`.
   The kb store is never written by the kernel.

## Open Questions

- Moving the bridge injector to `sections` would remove K5's forced path. This
  is a small follow-up.
- Whether `turn_start` needs consumers beyond the guard pause clock (phase 3
  epoch counter).
