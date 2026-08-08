# Fix promise handling in the client and plugin packages

> Rung 1b of the local-review-gate ladder (see commit `4b71d80d2` for the split
> rationale; the predecessor `cleanup-lint-debt-mechanical` was retired). It was
> calling 99 semantic decisions "mechanical" while its own sibling had been split
> off for being 54 of exactly the same kind.
>
> Revised after adversarial review: the scope was **still** counted over
> `packages/` while the ratchet checks repo-root, orphaning one finding.
>
> Revised again during planning after four scope decisions (see `design.md`
> §Decisions): bare `void` is banned, a global rejection handler is installed as
> the regression guard, **all 7 `packages/electron` sites move to the sibling**
> (the split is now drawn by *risk*, not package name), and the `scripts/`
> orphan is claimed here.

## Why

93 promise-handling defects sit outside the server, bridge, and electron main:
**88 floating promises** and **5 misused promises**. 70 of the floating ones are
in `packages/client` alone — more than the entire
`cleanup-async-semantics-server-extension` change.

Every floating one is an unhandled rejection path, and — as the planning
investigation confirmed — **nothing observes it**: no global rejection handler
exists in the client bundle. It surfaces as a silently-dropped user action or a
console error nobody reads. None of it is visible to the current gate, because
Biome's type-aware rules have never been enabled.

**The floating work is not mechanical, and calling it so is the error this rung
exists to correct.** Each of the 88 floating sites is a decision with three wrong
answers:

| Fix | Risk if wrong |
|---|---|
| `await` | in React: update-after-unmount, stale closures, and lost races — **not** "blocks the handler" (an async handler returns immediately; the earlier draft had this wrong). Adding `await` can also turn the call site into a new `noMisusedPromises` finding. |
| bare `void` | silences a rejection that should surface — makes the bug less diagnosable. **Banned by this change.** |
| `.catch(handler)` | usually right, but wrong when the caller must observe failure |

A blanket codemod across 88 sites would be a regression generator. The 5 misused
sites are the exception — 4 are mechanical narrowing rewrites (see below).

## Measured baseline

Re-derive before implementing — the tree moves (this count drifted 141 → 142 →
143 during planning alone). Use `--only`, **not** a probe config; the
`--config-path` form fails Biome's ignore-file resolution:

```bash
npx biome lint --only=lint/nursery/noFloatingPromises . --max-diagnostics=20000
npx biome lint --only=lint/nursery/noMisusedPromises . --max-diagnostics=20000
```

Re-derived at planning time: **143 floating sites** (143 diagnostics at 143
unique locations — there is no duplicate) and **11 misused**.

> An earlier draft of this section claimed "142 unique locations, one reported
> twice". That was wrong. The 142 came from a site-extraction regex that matched
> only `.ts/.tsx/.mjs/.js/.jsx` and silently dropped
> `packages/server/src/rpc-keeper/keeper.cjs:141`; the missing site was then
> rationalised as a duplicate. **Any re-derivation must include `.cjs`.** The
> phantom duplicate is what concealed the electron orphan below — recorded here
> because the same mistake is easy to repeat.

Sites owned by **this** change:

| Rule | Package | Sites |
|---|---|---|
| `noFloatingPromises` | client | 70 |
| | flows-plugin | 7 |
| | roles-plugin | 5 |
| | shell | 3 |
| | subagents-plugin, automation-plugin | 1 each |
| | **`scripts/nightly-verdaccio-serve.mjs:70`** | **1** |
| `noMisusedPromises` | client | 3 |
| | server (`tunnel/tunnel-core.ts:156,167`) | 2 |
| **total** | | **93** |

Sites **moved out** to `cleanup-async-semantics-server-extension` (main-process
risk profile, not client risk profile): `packages/electron` — 6 misused
(`main.ts:531,557,607,654`, `server-lifecycle.ts:454`, `doctor-window.ts:52`)
plus 1 floating (`main.ts:675`).

Floating graduation accounting: **143 = 88 (this change) + 55 (sibling: server
17 + extension 37 + electron `main.ts:675`, handed over by D3).**

> **Settled at implementation: 143 = 89 + 54.** Restructuring the `createInner`
> executor (`tunnel-core.ts:167`) made `createTunnel` able to reject where it
> previously hung, which turned the sibling's floating `promise.finally()` at
> `tunnel-core.ts:160` into a live unhandled rejection. It was therefore fixed
> here rather than left dangling — the same-function coupling this proposal
> already flagged, landing exactly as predicted. Server floating drops 17 → 16;
> the sibling's proposal and the gate's ownership table are updated to match.
Misused: **11 = 5 (this change) + 6 (electron, handed to the sibling by D3).**

**The electron handoff is a hard precondition, not a note.** As of this change's
drafting the sibling's proposal mentioned electron zero times and Non-Goaled
"any fix outside `packages/server` and `packages/extension`", and
`add-typeaware-lint-gate`'s ownership table still read "88 floating + all 11
misused" for this change. Under those documents all 7 electron sites were owned
by nobody and **neither rule could reach zero**. This change therefore also
updates the sibling's proposal and the gate's ownership table; see Tasks. If
that handoff is ever reverted, the 7 sites return here.

**Repo-root floating total is 143, not 142.** The extra site is
`scripts/nightly-verdaccio-serve.mjs:70` (`main();`) — outside `packages/`
entirely, and previously owned by **no rung**. Because the ratchet graduates on
`biome lint .` at repo-root and `scripts/` is not grandfathered,
`noFloatingPromises` could never have reached zero. **This change claims it.**

Misused promises **do** have an orphan problem — the 6 electron sites, see the
accounting above; an earlier draft asserted otherwise. Import cycles (17) have
no orphan, but note they are `lint/suspicious/noImportCycles`, already in the
default gate — not a nursery type-aware peer of these two rules.

The 2 `packages/server` **misused**-promise sites belong here, not to the
async-semantics sibling — that change owns *floating* promises in
server/extension only. This boundary is deliberate and was a source of ambiguity
in the pre-split proposal.

### The misused-promise sites are not what the proposal assumed

Inspection of all 5 retained misused sites shows **4 of them are not dropped
rejections at all** — they are promise-in-conditional truthiness guards used for
inflight memoization:

```ts
if (inflight) return inflight;          // client ×3, tunnel-core.ts:156
```

The promise is always truthy, so the guard is *correct by accident*. The fix is
a narrowing rewrite with **no behaviour change and no promise handling
involved** — but the narrowing is **per-site** (`!== undefined` for
`WorktreeActionsMenu.tsx`, `!== null` for the other three; see `design.md` D6).
Only `tunnel-core.ts:167` is a genuine defect:
`new Promise(async (resolve) => { ... })` — a throw inside the async executor is
swallowed and the outer promise never rejects nor settles.

This matters because the pre-split "99 semantic decisions" framing over-claimed:
the misused bucket is 4 mechanical + 1 real. The **floating** bucket is where
the semantic judgement actually lives.

## What Changes

- **Claim the `scripts/` orphan.** One floating promise outside `packages/`;
  without it the rule cannot graduate.
- **Install a global rejection handler first** (client bundle +
  `packages/electron` main). The pre-planning investigation found **none exists**:
  the only `unhandledRejection` listener in the repo is
  `packages/server/src/cli.ts:493`, scoped to the server CLI process. This is a
  deliberate amendment to the "no new instrumentation" Non-Goal — the handler is
  the change's **regression guard**, and it is what makes "how would we know if a
  discard hid a real failure?" answerable by a test.
- **Classify every floating site before editing it**, into **four** allowed
  fixes. Bare `void` is **banned**:

  | Fix | When |
  |---|---|
  | `await` | ordering is load-bearing |
  | **return the promise** | the caller can and should own it (common in React lifecycle/event paths) |
  | **`Promise.all` / `allSettled`** | parallel fan-out currently leaking each promise individually |
  | `.catch(handler)` | the rejection must be observed but not awaited |

  A discard must be written `void p.catch(handler)` — never bare `void p`. Bare
  `void` is the only option that can hide a defect, and with no global handler
  previously in place it would leave the rejection genuinely unobserved. This is
  the safest and largest-diff option, chosen deliberately.
- **Fix the 88 floating-promise sites** across client, flows-plugin,
  roles-plugin, shell, subagents-plugin, automation-plugin, and `scripts/`.
- **Fix the 5 misused-promise sites** in client (3) and server (2) — 4 narrowing
  rewrites plus 1 real async-executor defect. The narrowing is **per-site, not
  blanket**: `WorktreeActionsMenu.tsx` holds `Promise<boolean> | undefined` and
  needs `!== undefined`; the other three are `| null` and need `!== null`.
- **Record the electron handoff** in `cleanup-async-semantics-server-extension`
  and in the `add-typeaware-lint-gate` ownership table, so the 7 moved sites are
  owned rather than orphaned.
- **No severity flips.** `add-typeaware-lint-gate` owns those.

**Blast-radius caveat, now resolved rather than merely stated:** the earlier
draft kept the 6 electron `noMisusedPromises` sites here while admitting they
belonged with the sibling by risk. That inconsistency is removed — **all 7
electron sites (6 misused + 1 floating) move to
`cleanup-async-semantics-server-extension`**, which owns main-process risk. This
change still installs the electron-main global rejection handler, because that
is instrumentation rather than a promise-site fix.

**Merge coupling:** this change and `cleanup-async-semantics-server-extension`
both edit `packages/server` (this: 2 misused; sibling: 17 floating). Whichever
lands second must rebase, and neither may assume the other's state.

**The coupling is tighter than file-level.** Both changes edit the *same
function*: this one narrows `tunnel-core.ts:156` and restructures the async
executor at `:167`, while the sibling fixes the floating `promise.finally()` at
`:160` — all inside the same `createTunnel`/`createInner` block. A rebase here is
semantic, not line-level: restructuring the executor can invalidate the
sibling's fix. Whoever lands second must re-derive the diagnostics for that file
rather than assume the other's patch still applies.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — discharges the ratchet precondition for
  `noMisusedPromises` fully, and for `noFloatingPromises` jointly with
  `cleanup-async-semantics-server-extension` (this change clears 88 of the 143
  unique floating sites; that one clears the remaining 55 — server 17, extension
  37, electron 1).

## Non-Goals

- Any `packages/server` or `packages/extension` **floating**-promise fix
  (`cleanup-async-semantics-server-extension`).
- Dependency declarations or Biome overrides (`cleanup-undeclared-dependencies`).
- Import cycles (`cleanup-import-cycles`).
- Any rule severity flip (`add-typeaware-lint-gate`).
- Any `packages/electron` promise-**site** fix — all 7 moved to the sibling.
- Refactoring async architecture or converting callbacks to promises. Where a
  `.catch()` needs a logger, use the existing path.

**Amended Non-Goal:** "no new instrumentation" no longer holds absolutely. This
change adds exactly **two** new instruments, and no others:

1. A **global unhandled-rejection handler** in the client bundle and in electron
   main — the regression guard the Verification section demands.
2. A shared **`reportError()` helper** in `packages/client/src/lib/`. The client
   has no central logging module today (files call `console.error` directly), so
   "handlers route to the package's existing logging path" was undefined for the
   client. The helper defines it and gives the `.catch` handlers a single
   observable seam that tests can assert on.

## Impact

- `packages/client/**` (73 sites), `packages/flows-plugin/**` (7),
  `packages/roles-plugin/**` (5), `packages/shell/**` (3),
  `packages/server/**` (2 misused only), `packages/subagents-plugin/**` (1),
  `packages/automation-plugin/**` (1), `scripts/` (1).
- Plus the global rejection handler: client entrypoint + electron main.
- **This change is deliberately behaviour-changing.** `await` serializes and
  surfaces errors; `.catch()` adds handling that did not exist; `void` documents
  a discard.
- **The invariant needs to be testable, and "no intended change to observable
  product behaviour" is not.** "Intended" is author-internal and unfalsifiable,
  and these 93 sites have no baseline behaviour spec — that is precisely why
  they are defects. `scenario-design` must replace it with something a test can
  fail: per-surface behavioural assertions on the affected client paths, not a
  global claim.
- No protocol, persistence, or public API change.

## Open Questions

**Resolved during planning:**

- ~~Does a global rejection handler already exist?~~ **No.** Only
  `packages/server/src/cli.ts:493` (server CLI). This change installs one for
  client + electron main as its regression guard.
- ~~Should `void` be permitted at all?~~ **Bare `void` is banned.** Discards must
  be `void p.catch(handler)`.
- ~~Do the electron sites belong here?~~ **No** — all 7 moved to the sibling.
- ~~Claim the `scripts/` orphan?~~ **Yes.**

**Still open (deliberately — an output of this change, not a blocker):**

- **Is a floating promise in a React event handler actually a defect?** For many
  of the 70 client sites the rejection may be genuinely uninteresting. The
  distribution of fixes chosen across those 70 sites is evidence for or against
  the rule sitting at `warn` in `packages/client` rather than `error` — an input
  to `add-typeaware-lint-gate`. Record the tally; do not decide it here.

## Verification

The regression guard is now named: **the global unhandled-rejection handler**.
Once installed, an unobserved rejection is no longer silent — it is an
observable event a test can assert on. That converts the previously
unfalsifiable "no intended change to observable behaviour" into a testable
assertion: *no page-level unhandled rejection fires during the exercised
surfaces*.

`scenario-design` supplies the rest:

- per-surface E2E assertions (`tests/e2e/`) for the client paths whose promise
  handling changes, asserting zero unhandled rejections,
- a unit-level guard for the `tunnel-core.ts:167` async-executor defect (a throw
  in the executor must now reject the outer promise),
- and the lint-count ratchet assertion for the 93 claimed sites.

## Discipline Skills

- `systematic-debugging` — the classification pass is evidence-first: determine
  what each rejection currently does before deciding how to handle it.
- `review-code` — 88 semantic decisions; the review must see intent, not just the
  diff.
- `observability-instrumentation` — a `.catch()` that swallows silently is the
  same defect wearing a different hat.
- `doubt-driven-review` — the classification convention decides 88 edits and is
  expensive to revisit; stress it before it stands.
- `performance-optimization` — if an `await` lands in a render or event-handler
  hot path, measure rather than assume.
- `observability-instrumentation` also now covers the added global rejection
  handler itself — it must not become a silent sink.
