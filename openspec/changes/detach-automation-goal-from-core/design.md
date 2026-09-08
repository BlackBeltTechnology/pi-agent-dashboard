# Design — evidence appendix

> This change is a **request for validation**, not an implementation plan. This
> document exists so a reviewer can check every claim in `proposal.md` against
> the tree without re-deriving it. All line numbers are against `develop`.

## The doctrine being applied

Source: `openspec/changes/archive/2026-07-01-decouple-automation-action-registry/proposal.md`

Distilled into six rules:

1. **Publish/collect, not push-into.** `provide("<owner>.<axis>.<id>", frozen
   contribution)`; the owner reads with `consumeAll("<owner>.<axis>.")`.
2. **Owner owns the mechanism; contributor owns the payload.**
3. **Collect lazily at read time** → load-order independent.
4. **Built-ins are peers** — the owner self-publishes its defaults through the
   same door (`ctx.provide(CORE_ACTION_KEY, coreActionContributions())`).
5. **Neither side references the other** — no `dependsOn`, no imports.
6. **Boundary-validate each contribution, fail-open** — plain-object check,
   per-entry try/catch, warn once per key (see
   `automation-plugin/src/server/folder-scope-contributions.ts`).

Host primitives already present:

```ts
// packages/dashboard-plugin-runtime/src/server/server-context.ts:464-478
export type ProvideFn    = (name: string, value: unknown) => void;
export type ConsumeFn    = <T = unknown>(name: string) => T | undefined;
export type ConsumeAllFn = /* enumerate every provide()d entry by name prefix */
```

## Adoption asymmetry (the core finding)

| | `automation-plugin` | `goal-plugin` |
|---|---|---|
| `ctx.provide` / `consumeAll` call sites | 3 axes (`action.`, `folderscope.`, `worksource.`) | **0** |
| Product code in core | 1 pending registry + 1 event-wiring arm | **10 files** |
| Session correlation (on `develop`) | cwd-FIFO only (`consume(cwd)`) | token tier (`getGoalId`) + cwd-FIFO fallback, wired in core |
| Server entry size | substantial | 138 lines (shell) |

`automation-plugin/src/server/AGENTS.md` already records the correlation
doctrine verbatim:

> `onEvent` correlates run session **strictly by host-applied `automationRun.runId`
> stamp (NOT cwd-FIFO)**; cwd match removed to stop delivering prompt to
> unrelated same-cwd sessions.

## Verified anchors for each claim

| Claim | Anchor |
|---|---|
| core names plugin concepts | `shared/src/types.ts:425,435,442` |
| persisted to sidecar | `shared/src/session-meta.ts:128,153,160` |
| restored on cold start | `server/src/session/session-scanner.ts:128,132` |
| leaked onto generic plugin API | `dashboard-plugin-runtime/src/server/server-context.ts:144` |
| generic mapper reads the field | `…/server-context.ts:284` |
| core respawn policy from plugin word | `shared/src/session-meta.ts:211` |
| core finalize policy from plugin word | `server/src/pi/pi-gateway.ts:898` |
| cwd-FIFO ownership assignment (automation) | `server/src/event-wiring.ts:445` (`consume(cwd)`) |
| token-tier correlation (goal) | `server/src/event-wiring.ts:1379` (`getGoalId`) |
| tier-3 self-documented as race-prone | `spawn-process/headless-pid-registry.ts:170-176` |
| identity filed after spawn await | `server/src/server.ts:1519-1541` |
| identity must survive restart | `headless-pid-registry.ts:85-107` (`PersistedEntry`), `:363` |
| goal product in core | `server/src/goal/` (7 files) + `routes/goal-routes.ts` + `pending/pending-goal-link-registry.ts` |
| duplicate registries | `pending/pending-automation-run-registry.ts` vs `pending/pending-goal-link-registry.ts` — same `60_000` TTL, same cap `8` |

## Register-path matrix (input to Q2/Q3)

Every `session_register` sender and whether a token can accompany it:

| Sender | Path | New sessionId? | Token? | pid |
|---|---|---|---|---|
| `session-sync.ts:157` | connect + reattach | no | only if `isFirstRegister` | yes |
| `session-sync.ts:254` | in-process new/fork/resume | **yes** | **no key emitted** | yes — same `process.pid` |
| `bridge.ts:1825` | coordinator handshake (`provisional`) | no | no | yes |
| `bridge.ts:3171` | fresh session first register | first | `consumeSpawnToken()` | yes |
| keeper respawn | relaunch after crash | **yes** | **no** (spec `:417`) | new pi pid; keeper pid stable |

Scrub semantics that constrain Shape B:

```ts
// packages/extension/src/session-sync.ts:67-71
export function consumeSpawnToken(): string | undefined {
  const token = process.env.PI_DASHBOARD_SPAWN_TOKEN;
  delete process.env.PI_DASHBOARD_SPAWN_TOKEN;   // single-use, deliberate
  return token;
}
```

Rationale recorded in-tree (`session-sync.ts:143-146`): the scrub exists so *"any
pi process this pi later spawns (subagent, nested `pi`, reload) does NOT inherit
and re-report the consumed token"* — change `fix-spawn-token-env-leak`. Any
ref-carrying env var that survives to a nested process re-opens that class.

## Correlation-tier maturity on `develop`

The two features sit at different correlation maturity on `develop`:

- **goal** already rides the spawn-token tier: `headlessPidRegistry.getGoalId(
  sessionId)` (`event-wiring.ts:1379`), with cwd-FIFO only as a fallback
  (`pendingGoalLinkRegistry.consume(cwd)`, `:1383`).
- **automation** is still cwd-FIFO only: `pendingAutomationRunRegistry.consume(
  cwd)` (`:445`) — no token tier. It is the laggard that would migrate onto the
  generic token-keyed seam (Q8), closing its tier-3 race as a bonus.

So the seam's "reuse the existing token machinery" premise is proven by goal
today; the migration risk rides with automation, not goal.

## Candidate shape (NOT decided — subject to Q1–Q8)

```
plugin-core (dashboard-plugin-runtime) owns the MECHANISM
  spawnSession({ cwd, pluginRef })        ref filed with the token, pre-spawn (Q5)
  token → pluginRef                       reuses existing token machinery
  on register: resolve ref → notify owning plugin

plugins own the PAYLOAD (published, namespaced, immutable)
  automation → { kind: "automation", automationRun: {...} }
  goal       → { goalId }
  third-party→ { ...opaque ref }          future peer, no core change

SAME KEYS STILL EMITTED — core merges the blob it was handed and never
spells the words. .meta.json stays byte-identical → no migration needed.
```

Open design tension, unresolved: a ref slot alone does **not** remove the
lifecycle branches in Q6 (`isRecoveryCandidate`, `pi-gateway.ts:898`). Those need
either a declarative lifecycle block on the contribution or explicit plugin
hooks. Choosing between those two is a deliberate non-decision in this document.
