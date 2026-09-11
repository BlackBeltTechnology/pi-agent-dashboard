# Design: inject-dox-doctrine-and-describe

## Context

See proposal.md — Why. Relevant current state:

- `packages/extension/.pi/skills/project-init/dox-doctrine.md` (8.5 KB) is the
  canonical doctrine with three delimited sections: `dox:write`, `dox:read:kb`,
  `dox:read:manual`. `seed-doctrine.ts` splices WRITE + one READ variant into
  the target root `AGENTS.md`, marker-gated by `<!-- dox-doctrine -->`.
- `packages/kb-extension/src/extension.ts` registers `kb_search` /
  `kb_neighbors` / `kb_get` / `kb_guard_pause`, the `tool_call` search guard,
  the `tool_result` reindex + DOX nudge jobs. It registers NO
  `before_agent_start` handler.
- pi's `before_agent_start` event chains `{ systemPrompt }` across handlers and
  exposes `event.systemPromptOptions.contextFiles` (path + content of loaded
  `AGENTS.md` files). `dashboard-context-injector.ts` in the bridge already uses
  this hook, SPLICING on the `Current working directory:` anchor.
- `knowledge_base.json` layers project → `~/.pi/dashboard/` → defaults via
  `packages/kb/src/config.ts` (`NESTED_KEYS` deep-merge, validated).
  `readDiscipline.guard.mode` and `doxEnforcement` already live there.
- `kb dox init` creates `AGENTS.md` per directory with path-only rows.
  `dox-triage.ts` has `parseRows` / `replaceRowPurpose`.
- `kb-read-discipline` spec requires that any per-turn doctrine REDUCTION be
  gated on an A/B measurement. This change moves text; it does not reduce it.

```
+-----------------------------+        +----------------------------------+
| project-init (seed)         |        | kb-extension (runtime)           |
|  AGENTS.md += marker +      |        |  session/turn 1 in <cwd>         |
|  pointer to settings        |        |    resolve cfg.doctrine          |
|  kb dox init  (path rows)   |        |    unset  -> first-contact nudge |
|  offer dox-describe ------------+    |    kb     -> append READ         |
+-----------------------------+   |    |    +write -> append WRITE        |
                                  |    |    marker in contextFiles -> skip|
                                  v    +----------------------------------+
                        +---------------------------+
                        | dox-describe skill        |
                        |  kb dox describe --list   |
                        |  fan-out per dir (Agent)  |
                        |  write Purpose cells      |
                        |  reindex                  |
                        +---------------------------+
```

## Goals / Non-Goals

**Goals:**
- One canonical doctrine, owned and versioned by `kb-extension`, delivered
  per turn without per-project copies.
- READ/WRITE switchable per project through the existing config layering.
- First-contact flow that ends with a persisted project setting, never a
  per-turn nag.
- Legacy seeded projects neither double-load nor break.
- A repeatable way to turn a path-only tree into a searchable corpus.

**Non-Goals:**
- Reducing the per-turn doctrine byte count (A/B-gated; follow-up).
- A client-side kb settings dialog (follow-up).
- Auto-running `dox-describe` without a confirmed plan.
- Injecting search RESULTS (the pull-not-push requirement stays intact —
  only instruction text is injected).

## Decisions

**D0 — Refresh the canonical READ section BEFORE moving it.**
The seeded `dox:read:kb` section is stale relative to this repo's root
`AGENTS.md`: it lacks the `doc_type` lane rule (+ measured numbers), the
corpus boundaries (`kb_search` indexes `docs/ openspec/ packages/ .pi/`, NOT
`tests/ qa/ scripts/ docker/`; `ctx_search`/`memory_search` = session memory),
the trust-verdict row (`STALE`/`GONE`/`MOVED`/`FRESH`), and the
`ctx_execute_file` row. `kb-read-discipline` requires all of these to survive
any trim. So step one is to sync `dox-doctrine.md`'s READ section to the root
`AGENTS.md` READ content; byte-neutrality (no reduction, no A/B gate) is then
asserted against THAT baseline, not against the stale seed. Repo-specific
lines (`tsx packages/kb/eval/run-fixtures.ts`, the `docs/faq.md` grep row) stay
out of the canonical file.

**D1 — Carrier: `before_agent_start`, inserted BEFORE the CWD anchor.**
Alternatives: (a) keep seeding into `AGENTS.md` (status quo, drifts);
(b) ship the doctrine as a skill (skills are on-demand, doctrine must be
per-turn); (c) tool `promptGuidelines` only — they already carry lane/corpus
hints for `kb_search`, but cannot carry the WRITE discipline and are not the
per-turn doctrine table the spec governs.

Composition with the bridge: `spliceContextFragment` in
`dashboard-context-injector.ts` does `base.slice(0, lastIndexOf("\nCurrent
working directory: "))` + fragment — everything AFTER the last anchor is
discarded, and the bridge fragment itself contains no anchor. A plain append
therefore survives only when the bridge runs first. The kb handler MUST
insert its fragment immediately BEFORE the last anchor line (anchor
preserved), and append only when no anchor is present. Both orders then
survive: kb-first → doctrine sits before the anchor the bridge later slices
at; bridge-first → no anchor → append. Test both orders with the real
`spliceContextFragment`.

Reload safety: the handler is idempotent by content — if `event.systemPrompt`
already contains the `── dox doctrine ──` delimiter, it is a no-op. This holds
regardless of how pi treats handlers across `/reload` (the bridge's
`isActive()` is owned by `bridge.ts` and is not available to a standalone
extension). Insertion detail: `before + "\n" + fragment + "\n" + anchorLine…`.
Subagents spawned via the `Agent` tool load the extension too and therefore
receive the doctrine — intended (they must also search before grep), and no
worse than today, where they load the same `AGENTS.md`.

**D2 — Config shape.**
```json
"doctrine": { "inject": "kb" | "off", "write": false }
```
Added to `NESTED_KEYS` so project overlays global per key. Defaults:
`inject: "kb"`, `write: false`. Validation rejects unknown `inject` values.
"Unset" is KEY-presence, not FILE-presence: the existing `origin` field is
computed from whether a config file exists, which is the wrong signal (a
project file holding only `readDiscipline` has no doctrine choice).
`loadConfig` computes `doctrineSource` from the RAW layers before merging:
`project?.doctrine !== undefined ? "project" : global?.doctrine !== undefined
? "global" : "none"`. The `manual` variant is dropped (D5), so `inject` has
two values.

Resolution happens PER TURN in the handler, from `systemPromptOptions.cwd`
(not once at extension load from `process.cwd()`, which is the wrong cwd for
dashboard-spawned sessions and would never see the config written on turn 1).
Cost: two small JSON reads per turn; no cache. `loadConfig` THROWS on
malformed JSON / validation failure — the handler wraps it and, matching the
extension's existing startup precedent, falls back to built-in defaults
(READ injected, WRITE off), suppresses the first-contact nudge (a nudge that
writes into a broken file makes it worse), and warns once per session via
`console.warn("[kb] …")` (the extension's existing channel). Budget for the
whole handler (reads + build + insert): p95 < 20 ms.
Edge semantics: `doctrineSource` counts a layer only when its `doctrine` is a
non-null object (`{}` therefore IS a recorded choice = defaults; `null` or a
non-object fails validation → fallback path). `inject: "off"` means nothing is
injected; `write` is ignored in that case. `write` must be a boolean.

**D3 — First-contact = agent-driven nudge, not `ctx.ui`.**
When `doctrineSource == "none"`, the handler appends a short one-time
instruction: ask the user via `ask_user` (options: kb read / kb read+write /
off / ask later) and record the choice in `<cwd>/.pi/dashboard/knowledge_base.json`
by READ-MERGE-WRITE — read the file if present, set only the `doctrine` key,
preserve every other key, write valid JSON. Fires once per extension
instance (pi's cwd is fixed for a session), so "ask later" costs one prompt
per session, not per turn; the system prompt is rebuilt every turn, so turn 2
simply omits the nudge. The nudge states: in a non-interactive run, proceed
with defaults and write nothing. Alternative considered: `ctx.ui.select` at
`session_start` — works in the TUI but the dashboard RPC surface has no
equivalent, and the agent path works on both. The extension never writes
config itself; the agent writes it through the normal `write`/`edit` tool,
which keeps the change visible in the transcript. Accepted trade-off: an
LLM may defer the ritual to answer the user's prompt first — acceptable,
because defaults (READ on) already apply meanwhile.

**D4 — Legacy seed: skip injection AND nudge to migrate.**
If any `systemPromptOptions.contextFiles[].content` (pi loads only
`AGENTS.md`/`CLAUDE.md` context files, cwd→root, so a seeded root is always
present) contains a `<!-- dox:write:start -->`, `<!-- dox:read:kb:start -->`
or `<!-- dox:read:manual:start -->` delimiter, the cwd is a legacy seed: skip
injection (no double-load). Detection is on the DELIMITER alone — not
marker+delimiter — so a half-finished migration (marker removed, sections
left) is still detected. The new pointer block carries the marker but no
delimiter, so it never trips the check. Hand-maintained doctrine prose
without delimiters (this repo before D9) is NOT detectable; such projects
strip manually — which is why D9 lands atomically with the hook.

A legacy seed left alone would freeze that project on the drifted copy — the
very problem this change targets — and a `dox:read:manual` seed would
suppress the kb doctrine forever. So a legacy seed ALSO triggers a one-time
(per session) migration nudge in place of the first-contact nudge — unless the
resolved `inject` is `off`, in which case the project has opted out and
nothing is nudged: tell the
user the project carries a legacy copy; on confirmation, replace the block
from the marker (or first `dox:*:start`) through the matching `dox:read:*:end`
delimiter with the pointer block, then run the normal first-contact question. Declining leaves the file
untouched; the next session nudges again. Marker+delimiter removal is a
mechanical edit the agent performs; no CLI needed.

**D5 — Drop `dox:read:manual`; kb-extension is the doctrine's sole carrier.**
The manual variant existed for projects that may never install the extension.
Per user decision, "no kb" now means "unset → ask". A project without the
extension gets the pointer block only — i.e. NO READ table. This is an
explicit trade-off against `kb-read-discipline`'s "seeded project may never
install the kb extension" rationale: the pointer names the extension and
the settings file, and `project-init` enables the kb toolset when DOX is
chosen, so the extensionless case is a deliberate opt-out, not an accident.
The A/B gate concerns per-turn doctrine in kb-loaded projects and is not
triggered. Delta spec on `kb-read-discipline` carries the change.

**D6 — Pure module for the doctrine logic.**
`packages/kb-extension/src/doctrine.ts`: `loadDoctrineSections(path)`,
`hasLegacySeed(contextFiles)`, `buildDoctrineFragment({inject, write,
source})`, `buildFirstContactNudge(cwd)`. No pi imports, unit-testable like
`guard.ts` / `reindex.ts`. `extension.ts` only wires the hook.

**D7 — `dox-doctrine.md` moves to `packages/kb-extension/dox-doctrine.md`.**
Bundled with the package (`files` in package.json). `seed-doctrine.ts` no
longer reads it; it emits a fixed pointer block. In THIS monorepo the kb
corpus still indexes it (markdown under `packages/`); downstream installs
live under `node_modules`, which the default exclude drops — the doctrine is
reachable there only through injection, which is the point.

**D8 — `dox-describe` is a skill + a thin CLI helper.**
Location: `packages/kb-extension/.pi/skills/dox-describe/` (added to the
package `files`, same pattern as `packages/extension/.pi/skills/*`), so it
ships with the extension that carries the doctrine. `kb dox describe --list
[--json] [--dir <path>]` prints rows whose Purpose is empty, grouped by
`AGENTS.md` file, with the subject path. v1 is empty-cells only; a `--stale`
refresh mode is a follow-up (see Open Questions). The skill: (1) run
`--list`, (2) present a plan (dirs, files, rough token estimate; per-run cap
= 50 rows, the rest deferred to a re-run), (3)
`ask_user` confirm, (4) fan out one WRITE-CAPABLE subagent (general-purpose,
not `Explore`) per `AGENTS.md`, at most 4 in flight, with the row schema
rules (one line, `| File | Purpose |`, symbols verbatim, key exports/contracts,
no prose, ≤200 chars — condense, never promote to a sidecar; sidecar splitting
stays the parent's job via `scripts/split-large-agents.mjs`), (5) each
subagent edits only its own `AGENTS.md`, (6) parent runs `kb dox lint` + one
final reindex. Reindex contention: the extension's `tool_result` hook
schedules a debounced reindex automatically on every markdown write and a
skill instruction cannot suppress it, so each subagent instance WILL trigger
its own reindex against the single SQLite file. Mitigation is structural, not
instructional: fan-out is capped at 2 concurrent subagents, the scheduled
reindex must tolerate `SQLITE_BUSY` (log + drop; the parent's final reindex
is authoritative), and correctness never depends on the intermediate
reindexes because the `--list` walk reads files, not the index. Any inline `Agent` label runs with parent
defaults (write-capable); `Explore` is read-only and unsuitable. Accepted
trade-off: a wrong-but-non-empty Purpose is not revisited in v1 (no
correctness oracle exists; `--stale` refresh is the follow-up). Alternatives: a fully headless `pi -p` script
(`parallel-pi-model-workers` pattern) — kept as an escape hatch in the skill
for very large trees, not the default. Row writing reuses
`replaceRowPurpose` semantics; the CLI never calls an LLM.

**D9 — Dogfood in this change, atomically with the hook.**
Root `AGENTS.md` here loses the sections now injected; `.pi/dashboard/
knowledge_base.json` sets `doctrine: { inject: "kb", write: true }` in the
same commit as the hook, so this repo never sees double doctrine or a
first-contact nudge (its prose has no delimiters and is undetectable by D4).
Repo-specific rows that are NOT in the canonical file are RE-HOMED, not
dropped: the `docs/faq.md`/`README.md` grep row for build/run/setup, the
`tsx packages/kb/eval/run-fixtures.ts` reproduce line, the DocScribe /
caveman delegation, the subagent routing table, the commands. Net per-turn
READ content for this repo is therefore unchanged (contract: no reduction).

## Risks / Trade-offs

- [Extension not loaded → no doctrine at all for a seeded project] →
  Pointer block names the extension and the settings file; `doctor` skill
  gains a check "doctrine configured but kb-extension not loaded".
- [Nudge fires in headless/CI runs where nobody answers] → nudge says "if
  non-interactive, proceed with defaults and do not write config"; `inject`
  defaults to `kb` so READ still works.
- [Handler ordering with bridge splice injector] → insert-before-anchor (D1);
  test runs the real `spliceContextFragment` in both orders and asserts both
  fragments survive.
- [Legacy seed detection false negative → duplicate doctrine] → detection on
  delimiter comments that only the legacy seed emits; test with a real
  legacy-seeded fixture (kb AND manual variants).
- [Malformed project config after an agent write] → read-merge-write in the
  nudge; handler catches `loadConfig` errors, skips injection, warns once.
- [Parallel `dox-describe` subagents contend on the SQLite index] → ≤2 in
  flight; scheduled reindex tolerates `SQLITE_BUSY`; parent's final reindex is
  authoritative (D8).
- [`/reload` re-arms the once-per-session nudge flag] → accepted: reload is
  rare and the cost is one extra question; injection itself stays idempotent
  by delimiter.
- [Developer sessions in this repo between hook and dogfood commits see
  double doctrine] → accepted: worktree-internal, lands as one PR.
- [`dox-describe` cost on big trees] → plan-then-confirm, per-run cap,
  resumable by construction (empty cells only).
- [Subagents hallucinate purposes] → subagent must read the file it
  describes; rows for unreadable/binary files stay empty; `kb dox lint`
  catches schema breakage.
- [Spec drift: `kb-read-discipline` "seeded projects keep the full
  doctrine"] → explicit delta in this change; the A/B gate requirement is
  untouched because no reduction happens.

## Migration Plan

Single change, single PR; the order below is build order inside the worktree,
not separate releases.

1. Refresh canonical READ section (D0); config + doctrine module + hook with
   `write: false` default. Legacy-seeded projects: detected → skip + migration
   nudge.
2. Seed shrink + `project-init` SKILL.md update. New projects get the
   pointer block.
3. Dogfood (same PR): strip this repo's `AGENTS.md` per D9, set project
   `doctrine`, run the test suite + one manual session to confirm the fragment
   appears exactly once and the re-homed rows are present.
4. `dox-describe` skill + CLI helper; wire into `project-init` step 5.
5. Rollback: `doctrine.inject: "off"` in global config disables injection for
   projects without a project-level `doctrine` key; projects that recorded a
   choice must set `inject: "off"` in their own file (correct layering, not a
   defect). Re-seeding the legacy block is a `git revert` of the seed change;
   projects initialised in between keep the pointer block.

## Open Questions

- Exact wording/length of the first-contact nudge (tunable without spec
  change).
- Follow-up: `dox describe --stale` to refresh STALE-verdict rows (v1 is
  empty-cells only, D8).
- Follow-up: per-project kb settings dialog in the client.
- Follow-up: A/B run for trimming the READ table (gated per
  `kb-read-discipline`).
