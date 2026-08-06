# Fix promise handling in the client and plugin packages

> Rung 1b of the local-review-gate ladder (see commit `4b71d80d2` for the split
> rationale; the predecessor `cleanup-lint-debt-mechanical` was retired). It was
> calling 99 semantic decisions "mechanical" while its own sibling had been split
> off for being 54 of exactly the same kind.
>
> Revised after adversarial review: the scope was **still** counted over
> `packages/` while the ratchet checks repo-root, orphaning one finding.

## Why

99 promise-handling defects sit outside the server and bridge: **88 floating
promises** and **11 misused promises**. 70 of the floating ones are in
`packages/client` alone — more than the entire
`cleanup-async-semantics-server-extension` change (54).

Every one is an unhandled rejection path. In the client that usually surfaces as
a silently-dropped user action or a console error nobody reads; in
`packages/electron` (6 misused promises) it can mean a main-process handler that
never resolves. None of it is visible to the current gate, because Biome's
type-aware rules have never been enabled.

**This work is not mechanical, and calling it so is the error this rung exists to
correct.** Each site is a decision with three wrong answers:

| Fix | Risk if wrong |
|---|---|
| `await` | in React: update-after-unmount, stale closures, and lost races — **not** "blocks the handler" (an async handler returns immediately; the earlier draft had this wrong). Adding `await` can also turn the call site into a new `noMisusedPromises` finding. |
| `void` | silences a rejection that should surface — makes the bug less diagnosable |
| `.catch(handler)` | usually right, but wrong when the caller must observe failure |

A blanket codemod across 99 sites would be a regression generator.

## Measured baseline

Re-derive before implementing — the tree moves (this count drifted 141 → 142 →
143 during planning alone). Use `--only`, **not** a probe config; the
`--config-path` form fails Biome's ignore-file resolution:

```bash
npx biome lint --only=lint/nursery/noFloatingPromises . --max-diagnostics=20000
npx biome lint --only=lint/nursery/noMisusedPromises . --max-diagnostics=20000
```

| Rule | Package | Sites |
|---|---|---|
| `noFloatingPromises` | client | 70 |
| | flows-plugin | 7 |
| | roles-plugin | 5 |
| | shell | 3 |
| | electron, subagents-plugin, automation-plugin | 1 each |
| | **`scripts/nightly-verdaccio-serve.mjs:70`** | **1** |
| `noMisusedPromises` | electron | 6 |
| | client | 3 |
| | **server** | 2 |
| **total** | | **100** |

**Repo-root floating total is 143, not 142.** The extra site is
`scripts/nightly-verdaccio-serve.mjs:70` (`main();`) — outside `packages/`
entirely, and previously owned by **no rung**. Because the ratchet graduates on
`biome lint .` at repo-root and `scripts/` is not grandfathered,
`noFloatingPromises` could never have reached zero. **This change claims it.**
Cycles (17) and misused (11) have no such orphans — verified.

The 2 `packages/server` **misused**-promise sites belong here, not to the
async-semantics sibling — that change owns *floating* promises in
server/extension only. This boundary is deliberate and was a source of ambiguity
in the pre-split proposal.

## What Changes

- **Claim the `scripts/` orphan.** One floating promise outside `packages/`;
  without it the rule cannot graduate.
- **Classify every site before editing it.** The scheme has **five** buckets, not
  three — the original three could not express two common correct fixes:

  | Fix | When |
  |---|---|
  | `await` | ordering is load-bearing |
  | **return the promise** | the caller can and should own it (common in React lifecycle/event paths) |
  | **`Promise.all` / `allSettled`** | parallel fan-out currently leaking each promise individually |
  | `.catch(handler)` | the rejection must be observed but not awaited |
  | `void` | genuinely fire-and-forget AND the rejection is already handled downstream |

  `void` requires a stated reason — it is the only option that can hide a defect.
- **Check for an existing global rejection handler first.** If the client or
  electron main process installs `unhandledRejection` / `onunhandledrejection`,
  some sites are already observed and correctly become `void` + a pointer to that
  handler. This single question changes the right answer for potentially dozens
  of sites and must be answered before the classification pass, not during it.
- **Fix the 88 floating-promise sites** across client, flows-plugin,
  roles-plugin, shell, electron, subagents-plugin, automation-plugin.
- **Fix the 11 misused-promise sites** in electron (6), client (3), server (2).
- **No severity flips.** `add-typeaware-lint-gate` owns those.

**Blast-radius caveat, stated rather than hidden:** the 6 electron
`noMisusedPromises` sites are **main-process** (`src/main.ts:531,557,607,654`,
`server-lifecycle.ts:454`, `doctor-window.ts:52`). By risk they belong with the
sibling's server/extension work; they are here only because the split was drawn
by *package name*. Treat them with the sibling's per-site rigour, not the
client's.

**Merge coupling:** this change and `cleanup-async-semantics-server-extension`
both edit `packages/server` (this: 2 misused; sibling: 17 floating). Whichever
lands second must rebase, and neither may assume the other's state.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — discharges the ratchet precondition for
  `noMisusedPromises` fully, and for `noFloatingPromises` jointly with
  `cleanup-async-semantics-server-extension` (this change clears 88 of 142; that
  one clears 54).

## Non-Goals

- Any `packages/server` or `packages/extension` **floating**-promise fix
  (`cleanup-async-semantics-server-extension`).
- Dependency declarations or Biome overrides (`cleanup-undeclared-dependencies`).
- Import cycles (`cleanup-import-cycles`).
- Any rule severity flip (`add-typeaware-lint-gate`).
- Refactoring async architecture, converting callbacks to promises, or adding new
  instrumentation. Where a `.catch()` needs a logger, use the existing path.

## Impact

- `packages/client/**` (73 sites), `packages/electron/**` (7),
  `packages/flows-plugin/**` (7), `packages/roles-plugin/**` (5),
  `packages/shell/**` (3), `packages/server/**` (2 misused only),
  `packages/subagents-plugin/**` (1), `packages/automation-plugin/**` (1).
- **This change is deliberately behaviour-changing.** `await` serializes and
  surfaces errors; `.catch()` adds handling that did not exist; `void` documents
  a discard.
- **The invariant needs to be testable, and "no intended change to observable
  product behaviour" is not.** "Intended" is author-internal and unfalsifiable,
  and these 100 sites have no baseline behaviour spec — that is precisely why
  they are defects. `scenario-design` must replace it with something a test can
  fail: per-surface behavioural assertions on the affected client paths, not a
  global claim.
- No protocol, persistence, or public API change.

## Open Questions

- **Is a floating promise in a React event handler actually a defect?** For many
  of the 70 client sites the rejection is genuinely uninteresting. If a large
  fraction are `void`-with-reason, that is evidence the rule belongs at `warn`
  in `packages/client` rather than `error` — an input to
  `add-typeaware-lint-gate`.
- **Does a global rejection handler already exist** in the client bundle or the
  electron main process? Answering this first may collapse a large share of the
  classification work.
- **Should `void` be permitted at all?** Banning it forces every site to await or
  handle — safer, larger. Permitting it keeps the diff small but re-hides the bug
  class this change exists to surface.

## Verification

**There is currently no named regression guard for 73 client + electron sites.**
The sibling change names `ws-broadcast-load-harness` for its hot paths; this
change named nothing, and the cited discipline skills are *review* practices, not
verification. `scenario-design` must supply:

- per-surface E2E assertions (`tests/e2e/`) for the client paths whose promise
  handling changes,
- an electron main-process check for the 6 misused sites,
- and a concrete answer to "how would we know if a `void` hid a real failure?"

## Discipline Skills

- `systematic-debugging` — the classification pass is evidence-first: determine
  what each rejection currently does before deciding how to handle it.
- `review-code` — 99 semantic decisions; the review must see intent, not just the
  diff.
- `observability-instrumentation` — a `.catch()` that swallows silently is the
  same defect wearing a different hat.
- `doubt-driven-review` — the classification convention decides 99 edits and is
  expensive to revisit; stress it before it stands.
- `performance-optimization` — if an `await` lands in a render or event-handler
  hot path, measure rather than assume.
