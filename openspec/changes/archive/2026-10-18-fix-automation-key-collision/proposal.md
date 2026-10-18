## Why

Two automations in different repos can silently share scheduler and concurrency
state, and one of them can leak a timer that fires forever with no handle to
dispose it.

`automationKey` is `` `${scope}:${name}` ``
(`packages/automation-plugin/src/server/scheduler.ts:61`) — it carries no
location. The engine arms every scope a server sees, one `folder` scope per
distinct session cwd, into a single scheduler. So two repos that each define a
folder automation named `deploy` both key as `folder:deploy`, which causes two
distinct defects:

1. **Leaked timer.** `armOne` does `armed.set(automationKey(automation), …)`
   without disposing an existing entry for that key (`scheduler.ts:138`).
   `armAll` is safe only because it pre-disposes every key *before* the arm
   loop — but a key collision happens *within* one `armAll` batch, so the second
   automation overwrites the first's `Disposable` and the first timer keeps
   firing with nothing holding its handle. It cannot be disposed for the
   lifetime of the process.
2. **Shared concurrency slot.** The runner keys `active` by the same
   `automationKey` (`packages/automation-plugin/src/server/runner.ts:66`), so
   the two unrelated automations contend on one concurrency slot. Under the
   default `concurrency: skip`, one repo's `deploy` is silently dropped because
   the *other* repo's `deploy` is running.

Both are latent and surface only on a name collision across workspaces — but a
dashboard routinely serves many folders at once, and generic automation names
(`deploy`, `nightly`, `sync`) are exactly the ones users pick.

This also blocks follow-on work: any cross-process duplicate-fire guard keyed on
`automationKey` inherits the collision, so this must land first. That guard is
scoped separately in `add-automation-occurrence-guard`.

## What Changes

- **Make `automationKey` collision-free: `` `${scope}:${dir}` ``.**
  `DiscoveredAutomation` already carries `dir` — the absolute path of the
  automation's own directory, built as `path.join(base, ".pi", "automation",
  name)` (the `dir` field: `packages/automation-plugin/src/shared/automation-types.ts:149-150`;
  its construction: `packages/automation-plugin/src/server/scanner.ts:18-19,43`). It is unique per
  definition by construction, so the key needs no new field, no signature
  change and no filesystem I/O. `scope` stays in the key so existing
  scope-specific behaviour (a base equal to HOME arms under `global` only —
  `engine.test.ts` E7) is unchanged. The key is an opaque identifier; nothing
  parses it.
- **Make `armOne` self-disposing** — dispose any existing entry for the key
  before `armed.set`, so "no armed trigger is replaced without being disposed"
  holds for any caller rather than depending on `armAll` pre-disposing. The
  production pipeline cannot hand `armAll` the same `dir` string twice:
  `folderScopeBases()` dedupes bases through a `Set` of `path.resolve`d paths
  (`packages/automation-plugin/src/server/index.ts:292-297`) before scanning,
  which `engine.test.ts` E4/I2 mirrors with a test-local helper. (Two
  *spellings* of one directory are a different case — see the known limitation
  below — and produce two distinct keys, not a duplicate.) The duplicate stays
  reachable through
  the scheduler's public surface (`engine.scheduler.armAll` with repeated
  entries, `rearmOne`), and this is the exact mechanism of defect 1, so the
  one-line guard is kept and tested by calling `armAll` directly. Note that
  `armOne` returns early for a disabled or invalid entry, so if a duplicate's
  second copy is disabled the first copy stays armed: the outcome depends on
  order, which is acceptable for an input the production pipeline never
  produces.

**Not in scope:**

- **`concurrency` semantics are unchanged.** `skip`/`queue`/`parallel` behave
  exactly as today; the change only corrects *which slot* an automation maps to,
  so same-named automations stop sharing one.
- **No path normalization (realpath).** Known limitation: one on-disk
  definition reached through two spellings (a symlinked cwd and its target, or
  a case variant on a case-insensitive filesystem) yields two `dir` strings and
  is armed twice. That is no worse than today — under the name key the two
  collided and the first timer leaked, so both fired then too; after this
  change both still fire, but both are disposable. Normalization was considered
  and dropped: it would add
  synchronous filesystem I/O on the per-fire path, throw inside the unguarded
  `armAll` loop when a directory disappears, and still miss case-variant
  spellings on case-insensitive filesystems. It would also contradict the
  existing contract: `automation-folder-scope-contribution` ("Contribution is
  opt-in and validated") already requires that bases be deduped "by resolved
  path (the same `path.resolve` applied to session cwds, not `realpath`)", and
  `folderScopeBases()` implements exactly that
  (`packages/automation-plugin/src/server/index.ts:292-297`). The key follows
  the same identity rule.
- **`role-usage.ts` label** (`packages/automation-plugin/src/server/role-usage.ts:22`)
  builds its own `` `${a.scope}:${a.name}` `` display label independently of
  `automationKey`. It is not changed here.
- **Client React key collision** — `AutomationBoard.tsx` uses the same
  `` `${a.scope}:${a.name}` `` shape as a React key and selection id, so two
  same-named automations collide in the board UI. Same bug class, client-side;
  tracked as a follow-up rather than widening this server change.
- The cross-process duplicate-fire guard, and any `packages/server` change.

## Discipline Skills

- `review-code` — non-trivial change with tests passing before commit (the
  checkpoint in AGENTS.md).
- `systematic-debugging` — only if a RED test does not fail for the predicted
  reason; a test that passes when it should fail means the collision model is
  wrong and must be root-caused before any source edit.

Not triggered: no auth/untrusted-input/secrets/PII surface
(`security-hardening`), no latency or large-data path
(`performance-optimization`), no new endpoint/job/external call
(`observability-instrumentation`), no irreversible or public-API step
(`doubt-driven-review` — already run during planning).

## Capabilities

### Modified Capabilities

- `automation-trigger-registry` — "Central scheduler arms schedule triggers"
  gains the guarantee that each automation definition is scheduled as its own
  unit, identified by scope and resolved on-disk location rather than name:
  same-named automations in different directories are armed, fired and disposed
  independently, a definition presented twice at one location is armed once,
  and no trigger survives disposal.
- `automation-run-lifecycle` — "Concurrency policy per automation" defines its
  existing phrase "the same automation" as the same definition (scope +
  resolved location), so a run of one same-named automation is not an active
  prior run of another. The policies themselves are unchanged.

## Impact

- **Code**: `packages/automation-plugin/src/server/scheduler.ts`
  (`automationKey`, `armOne`). `runner.ts` and `engine.ts` consume the key via
  the shared import and need no change.
- **Tests**: every literal `scope:name` key assertion in `scheduler.test.ts`,
  `engine.test.ts` and `runner.test.ts` moves to the new format. This includes
  the caller-supplied key in `scheduler.test.ts:250`
  (`sched.rearmOne("folder:a", …)`): an old-format key there would miss
  `disposeKey` while `armOne` arms under the new key, leaving a stale trigger.
  `rearmOne` has no production caller (the watcher path uses `armAll`), so this
  is test-only today. `role-usage.test.ts` is unaffected — its label is not the
  key.
- **Behaviour change**: folder automations that previously collided on
  `scope:name` become independent. An automation that was being silently
  suppressed by an unrelated same-named automation's concurrency slot **may
  start running for the first time**. Call out in the changelog — for an
  affected user this looks like a new automation appearing, not a bug fix.
- **Known UI follow-up**: the newly independent pair still shares the board's
  React key and selection id (`AutomationBoard.tsx:245-250`) and the roles
  "used by" label (`role-usage.ts:22`), so selecting one may highlight the
  other and the label cannot tell them apart. Display-only; scheduling is
  correct.
- **Logs**: scheduler/engine log lines carry the absolute definition path
  instead of `scope:name`. `server.log` already records absolute cwd paths, so
  this adds no new disclosure class.
- **Risk**: low and self-contained. The key is verified in-memory and log-only:
  its only consumers are the scheduler's `armed` map, the runner's `active` map,
  the transient `ParentState`, and log lines. Persisted run records are keyed by
  `storeStartParentRun(scopeBase, name, …)`, `RunRecord` has no key field, and
  `/list` / `/runs` return `DiscoveredAutomation` / `RunRecord`, so no on-disk
  artifact or API response embeds the key and no migration is required.
