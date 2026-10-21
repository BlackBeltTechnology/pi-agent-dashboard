# context-manager-blackhole-fork

> Phase 2a of the umbrella `openspec/changes/unify-context-manager` (roadmap
> task 1.2a). Depends on `context-manager-kernel` (flag, chassis, registry,
> `/context`), which ships first.

## Why

pi-blackhole compacts mid-run by monkeypatching `AgentSession.compact`
(`src/om/inline-compaction.ts`, 1,116 LOC). Every pi release has broken that
patch, and pi 0.87+ offers the same job publicly: a `compaction` entry returned
from `turn_end` / `agent_before_settle`. A pi 1.3.0 spike (2026-10-21) showed
that the public path works mid-run and at end of run. It also showed that pi
emits no `session_compact` event for it, which the dashboard's live compaction
divider needs. Forking blackhole (MIT) into the context manager removes the
patch, drops about 10.7k LOC of settings/TUI/changelog code, and puts
compaction behind the single hook owner.

## What Changes

- **Fork** pi-blackhole v0.5.15 from its git tag (commit `0ce5ce5f`, with
  upstream tests) into `packages/context-manager/src/blackhole/`: upstream
  `NOTICE` kept, one header per forked file naming its upstream path and
  version. Kept: the VCC deterministic summary (`src/core`, `src/extract`),
  the observational-memory workers and ledger (`src/om`), `recall`, the
  `context` replay, export.
- **Dropped at fork time** (recounted, design B2): `src/pi-base/` (8,417 LOC),
  `src/changelog/` (645), `src/om/status-bar.ts` (385),
  `src/om/inline-compaction.ts` (1,116; only `hasTrailingUnpairedToolCall`
  survives), `src/core/settings.ts`, the TUI-only command code, and the tests
  of dropped modules: about 10.6k LOC, leaving about 28k.
- **Boundary compaction** (umbrella D3): threshold compaction returns a
  `compaction` entry draft from `agent_before_settle` (end of run, the
  default `midRunCompaction: "off"`, replacing upstream's `agent_end` +
  `isIdle` + `ctx.compact()`) or from `turn_end` (mid-run, `"resume"`, and
  every non-persisted session). The boundary path vendors pi 1.3.0's
  unexported `prepareCompaction` (MIT, ~250 LOC with its helpers), so the
  upstream summary builder receives exactly the `preparation` pi's own
  compaction would pass it; a deep-equality test against pi's real
  `session_before_compact` detects drift on pi bumps. No private pi API is
  called. `"pause"` keeps upstream's public `ctx.compact()` for persisted
  sessions.
  Manual and overflow compaction keep using `session_before_compact` with the
  same summary builder.
- **Chassis grows** to own `turn_end`, `agent_before_settle`, `context`,
  `session_before_compact`, `agent_start`, `agent_end`, `agent_settled`,
  `session_compact` and `session_compact_failed`, with stated composition rules,
  and opens two kernel extension points: consumer tools under the kernel's
  tool lifecycle, and `/context <name>` subcommands.
- **Upstream-compatible state:** the same config files and env vars, pending
  and cooldown files, `om.*` custom entries and compaction `details`. The
  dashboard's blackhole-plugin keeps working, and switching between upstream
  and the fork in either direction keeps observations.
- **No name collisions with upstream:** commands become `/context`
  subcommands (`compact`, `memory [on|off|cleanup]`, `recall`, `export`) and
  the headless flag becomes `--context-export`. `/blackhole configure|settings|changelog`
  are dropped. `recall` goes through the kernel's tool lifecycle (registered
  only in `active` sessions).
- **Bridge:** alongside the unchanged `UsageDrain`, the bridge collects
  `compaction` entries (from every drain plus a read-only peek at
  `turn_start`). For one that pi persisted without emitting `session_compact`
  (any extension's boundary compaction), it forwards a synthesized
  `session_compact` at the next `turn_start` or `agent_settled`, so the live
  divider appears. Ids announced live or replayed are never announced again.
  It carries no `reason`, so it shows no badge.
- **blackhole-plugin:** its installed check also accepts the context-manager
  package.
- **BREAKING (fork only, flag-on sessions):** the `/blackhole*` command names
  and `--blackhole-export` exist only in upstream; the fork uses `/context`
  subcommands and `--context-export`.

## Capabilities

### New Capabilities
- `boundary-compaction`: threshold, cut and summary of deterministic compaction
  on pi's boundary API; manual/overflow path; `context` replay; no private pi
  internals.
- `observational-memory`: the forked observer/reflector/dropper pipeline,
  `recall`, export, and the upstream-compatible state formats.

### Modified Capabilities
- `compaction-boundary-replay`: a boundary compaction that pi does not announce
  is announced live by the bridge (ADDED requirement); the "no
  compaction-specific dedup path" rule allows the announced-id set (MODIFIED).
- `blackhole-plugin-settings`: the self-gate accepts the context-manager
  package as the extension.
- `blackhole-plugin-session-pipeline`: the global installed check accepts the
  context-manager package.
- `context-manager-runtime` (added by `context-manager-kernel`): the chassis
  owns the compaction and context hooks; consumers can contribute tools and
  `/context` subcommands (ADDED requirements).

## Impact

- **New code:** `packages/context-manager/src/blackhole/**` (~28k forked LOC
  of 38.7k, plus ~250 LOC vendored from pi) and its ported tests; `NOTICE`.
- **Changed:** `packages/context-manager` chassis and `/context` command;
  `packages/extension` (bridge `session_compact` synthesis);
  `packages/blackhole-plugin` (installed check).
- **Dependencies:** peers `@earendil-works/pi-agent-core` (the OM workers'
  agent loop), `@earendil-works/pi-ai` (23 modules, incl. `pi-ai/compat`),
  `@earendil-works/pi-tui` (`core/format.ts`, `hooks/cosmetic-output.ts`,
  `commands/cleanup.ts`, `om/key-matcher.ts`) and `typebox`
  (`tools/recall.ts`), as upstream declares them; devDependency `pi-blackhole@0.5.15` for the compatibility
  test only. No runtime dependency added.
- **Compatibility:** pi `>=1.3.0`. Flag off (default): nothing changes. Flag on
  with pi-blackhole installed: the kernel refuses (K2), nothing changes.
- **Data:** no new store; upstream files and entry formats are reused as-is.
- **Rollback:** flag off, or reinstall pi-blackhole. State is shared, so
  nothing is lost in either direction.
- **Not in this phase:** the session index, `session_search` and
  `skill_manage` (2b); the hermes distillers (3); the unified plugin (6).

## Discipline Skills

- `doubt-driven-review`: the fork and the retirement of the monkeypatch are
  hard to reverse once the old path is gone; reviewed during planning.
- `performance-optimization`: the threshold check runs at every `turn_end`;
  budgeted in the specs.
- `observability-instrumentation`: compaction decisions, skipped compactions
  and the bridge synthesis are logged.
- `review-code`: before commit.
- `code-simplification`: the fork must actually shed the dropped LOC.
- `security-hardening`: not triggered. No new input surface: the fork reads the
  same local config and session data as upstream, and writes the same files.
