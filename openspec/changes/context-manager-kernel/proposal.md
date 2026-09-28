# context-manager-kernel

> Phase 1 of 6 of the umbrella `openspec/changes/unify-context-manager`
> (roadmap task 1.1). The umbrella fixes the target architecture; this change
> carries the first behavioural deltas.

## Why

Every later phase needs a single place to plug in. Today four extensions each
subscribe to the same pi hooks, and three of them rewrite `systemPrompt` every
turn. The kernel creates the one owner of the context hooks, the retrieval tools
and the injection slot. The forks, cues, exec/web and miner phases then add
consumers instead of more hook owners.

## What Changes

- **New package `packages/context-manager`**
  (`@blackbelt-technology/pi-dashboard-context-manager`), a pi extension.
- **Enable flag** (the umbrella's `contextManager.enabled`): layered config
  `<cwd>/.pi/dashboard/context_manager.json` →
  `~/.pi/dashboard/context_manager.json` → default off. The env var
  `PI_CONTEXT_MANAGER=0|1` overrides it. When the flag is off at load, the
  package registers nothing.
- **Overlap refusal:** the kernel detects pi-hermes-memory, pi-blackhole and
  context-mode by exact package identity: tool `sourceInfo` (`npm:<name>`, or
  a path resolving to a package.json `name`). It never matches tool names or
  settings entries. The check runs once per turn epoch, before the kernel or
  kb-extension acts. On a hit it is inert, and from then on the session is as
  today.
- **Hook chassis:** one subscription per context hook, with an ordered,
  fault-isolated consumer registry. Re-registration by an owner replaces its
  earlier entries, so `/reload` is safe. The chassis' `tool_result`
  subscription is the umbrella's "capture tap"; later phases add consumers,
  not hooks, and nothing is captured in this phase.
- **kb-extension becomes a chassis consumer:**
  - Each kb-extension instance binds its own handler bodies, plus docs and
    doctrine providers, into its session's slot of a versioned process-global
    registry. In-process child sessions get their own slots.
  - While the kernel is active, its own subscriptions skip, and the kernel
    dispatches the same bodies. There is one guard, one reindex state and one
    `kb_guard_pause`.
  - Only doctrine delivery changes shape.
- **Injection owner:** a byte-stable pinned section in
  `systemPromptOptions.sections` holds the doctrine now and pinned lessons in
  phase 3. A sentinel-anchored insertion covers prompts forced by the bridge,
  which is the normal dashboard path. One per-turn message carries onboarding
  nudges (whole) and, from phase 3, budgeted cues.
- **Scopes:** `docs` (kb-extension's store and code path, unchanged; the
  default for `context_search` in this phase); `lessons`
  (a separate node:sqlite kb database under
  `<root>/.pi/dashboard/context_manager/`, over `<root>/.pi/lessons/` (`<root>`
  = git toplevel) and `~/.pi/agent/lessons/`; searched when named); `sessions` and `web` (registered, empty until
  phases 2 and 4).
- **Tools:**
  - `context_search(query, scope?, limit?, format?, doc_type?)`: per-scope
    search, fused with Reciprocal Rank Fusion. Abstention is off by default;
    a per-project calibration script writes a floor only when held-out
    Recall@10, P@1 and MRR hold. This change runs it for this repo.
  - `context_get(ref, scope?, section?, neighbors?)`.
- **Aliases corrected:** pi 0.87.1 does not execute calls to inactive tools.
  `kb_search`/`kb_get`/`kb_neighbors` therefore stay active and unchanged in
  this phase. They are slimmed at cutover. Umbrella D6 and task 1.1 are
  amended.

## Capabilities

### New Capabilities
- `context-manager-runtime`: the flag, activation state, overlap refusal, hook
  chassis, kb-extension consumer handover, and the pinned/per-turn injection
  owner.
- `context-retrieval-tools`: the scopes, `context_search` (RRF, abstention
  floor), `context_get`, and the unchanged kb tools as aliases.

### Modified Capabilities
- `kb-doctrine-injection`:
  - while the kernel is active, the doctrine arrives in the kernel's pinned
    section instead of kb-extension's `systemPrompt` append;
  - first-contact and migration nudges arrive in the kernel's per-turn message.
- `kb-read-discipline`: `context_search` and `context_get` reset the guard
  chain.

## Impact

- **New:** `packages/context-manager/`, including
  `eval/negatives.in-domain.json` and `eval/negatives.off-domain.json`
  (hand-written, with no session content).
- **Changed:** `packages/kb-extension/src/extension.ts`.
  - Every hook body (2× `tool_call`, 2× `tool_result`, `turn_start`,
    `before_agent_start`) registers in the chassis registry and checks it per
    event.
  - The `kb_search`/`kb_get`/`kb_neighbors` bodies are exposed as the docs
    provider.
  - The doctrine body is split into a pinned provider and a message provider.
  - The guard reset set gains the new tools.
- **Unchanged:** `packages/kb` (used as the engine).
- **Changed:** `.gitignore` gains `.pi/dashboard/context_manager/`.
- **Flag off (default):** no behaviour change for any session. Flag on
  beside the old packages: also none (refusal).
- **Compatibility:** pi peer `>=0.87.1` (the verified version); node:sqlite
  only.
- **Rollback:** flag off or remove the package; delete
  `<root>/.pi/dashboard/context_manager/`. The kb store is never written by
  the kernel.
- **Not in this phase:** the lesson format and `lesson` (phase 3), the session
  index and forks (phase 2), `exec` and the web tap (phase 4), the plugin and
  the recommended entry (phase 6).

## Discipline Skills

- `doubt-driven-review`: the new public tool surface and alias semantics
  (applied during planning; four cycles, single- and cross-model).
- `performance-optimization`: the chassis sits on every tool event; there is a
  p95 budget in the specs.
- `observability-instrumentation`: the new hooks, the refusal path and
  `/context status`.
- `review-code`: before commit.
- `security-hardening`: not triggered. Lessons are repo- or home-owned
  markdown pulled on demand like `docs`. Calibration negatives are
  model-written and grep-validated (no mined session content). Nothing from lessons is auto-injected in this
  phase.
