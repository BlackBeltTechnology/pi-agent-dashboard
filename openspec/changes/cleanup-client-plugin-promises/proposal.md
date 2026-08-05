# Fix promise handling in the client and plugin packages

> Rung 1b of the local-review-gate ladder. Split out of
> `cleanup-lint-debt-mechanical` after doubt-driven-review cycle 3: that change
> was calling 99 semantic decisions "mechanical" while its own sibling had been
> split off for being 54 of exactly the same kind.

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
| `await` | serializes; in React, can turn an event handler into a blocking path |
| `void` | silences a rejection that should surface — makes the bug less diagnosable |
| `.catch(handler)` | usually right, but wrong when the caller must observe failure |

A blanket codemod across 99 sites would be a regression generator.

## Measured baseline

Re-derive before implementing (`npx biome lint --config-path=<probe> . --max-diagnostics=20000`);
the tree moves — this count drifted 141 → 142 during planning alone.

| Rule | Package | Sites |
|---|---|---|
| `noFloatingPromises` | client | 70 |
| | flows-plugin | 7 |
| | roles-plugin | 5 |
| | shell | 3 |
| | electron, subagents-plugin, automation-plugin | 1 each |
| `noMisusedPromises` | electron | 6 |
| | client | 3 |
| | **server** | 2 |
| **total** | | **99** |

The 2 `packages/server` **misused**-promise sites belong here, not to the
async-semantics sibling — that change owns *floating* promises in
server/extension only. This boundary is deliberate and was a source of ambiguity
in the pre-split proposal.

## What Changes

- **Classify every site before editing it.** Each fix is `await` (ordering is
  load-bearing), `void` (genuinely fire-and-forget AND the rejection is already
  handled downstream), or `.catch(handler)` (the rejection must be observed).
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
  a discard. The invariant to hold is **"no intended change to observable product
  behaviour"** — not "behaviour-preserving", which is false for every site here.
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
