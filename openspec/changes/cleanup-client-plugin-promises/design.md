# Design — Fix promise handling in the client and plugin packages

## Context

Biome's type-aware nursery rules `noFloatingPromises` and `noMisusedPromises`
have never been enabled in this repo, so 143 floating-promise sites and
11 misused-promise sites accumulated invisibly. The `code-quality-loop` ratchet
graduates on `biome lint .` at **repo-root**, so every site must be claimed by
some rung before either rule can move off nursery-info status.

This change (rung 1b) owns 93 of them: 88 floating + 5 misused. Its sibling
`cleanup-async-semantics-server-extension` owns 54 floating (server 17 +
extension 37), and — per D3 — now also the 7 `packages/electron` sites
(1 floating + 6 misused). 88 + 54 + 1 = 143 floating; 5 + 6 = 11 misused.

Two facts discovered during planning drive most of this design:

1. **No global unhandled-rejection handler exists** outside
   `packages/server/src/cli.ts:493` (server CLI process only). Nothing in the
   client bundle or electron main observes a dropped rejection. The proposal's
   original option of "`void` because it's handled downstream" was therefore
   never available — there is no downstream.
2. **4 of the 5 retained misused sites are not rejection defects.** They are
   promise-in-conditional truthiness guards (`if (inflight) return inflight`)
   used for inflight memoization — correct by accident, fixable by narrowing,
   behaviour-preserving. The real semantic work is entirely in the 88 floating
   sites.

Constraint carried from the proposal: this change is **deliberately
behaviour-changing** and the 93 sites have no baseline behaviour spec. The
verification strategy cannot rest on "no intended behaviour change" — that claim
is unfalsifiable.

## Goals / Non-Goals

**Goals:**

- Drive `noFloatingPromises` to zero across `packages/client`,
  `packages/flows-plugin`, `packages/roles-plugin`, `packages/shell`,
  `packages/subagents-plugin`, `packages/automation-plugin`, and `scripts/`.
- Drive `noMisusedPromises` to zero in `packages/client` and `packages/server`.
- Install a global unhandled-rejection handler in the client bundle and in
  electron main, so that an unobserved rejection becomes an **observable event**
  rather than silence.
- Leave behind a per-site classification record, so the fix distribution can
  inform `add-typeaware-lint-gate`'s severity decision.

**Non-Goals:**

- Any `packages/electron` promise-**site** fix (all 7 → sibling). The electron
  global handler is still installed here; it is instrumentation, not a site fix.
- Any `packages/server` or `packages/extension` *floating*-promise fix (sibling).
- Any rule severity flip (`add-typeaware-lint-gate`).
- Dependency declarations / Biome overrides (`cleanup-undeclared-dependencies`),
  import cycles (`cleanup-import-cycles`).
- Async architecture refactors, callback→promise conversions, or any
  instrumentation beyond the single global handler.

## Decisions

### D1 — Bare `void` is banned; discards must be `void p.catch(handler)`

**Alternatives considered:** (a) permit bare `void` with a reason comment —
smallest diff; (b) permit `void` only with an attached `.catch` — middle;
(c) ban bare `void` outright — chosen.

**Rationale:** an earlier draft justified the ban with "no global handler exists,
so a bare `void` is genuinely unobserved". That reason does not survive D2+D7 —
the handler lands *first*, so by the time sites are edited a bare `void` **is**
observed. The ban rests on a different and durable argument:

- A global handler is a **net, not a decision.** It tells you a rejection escaped;
  it cannot tell you whether the author considered that rejection and accepted
  it. `void p.catch(handler)` records the author's intent at the site.
- The net is **process-global and unattributable.** A rejection caught there
  names no owner and no remediation. Per-site handling does.
- Bare `void` is the one fix whose wrongness is **invisible in review** — it looks
  identical whether the author reasoned carefully or gave up.

This is knowingly the largest-diff option.

**Consequence:** the four allowed fixes are `await`, `return` the promise,
`Promise.all` / `allSettled`, and `.catch(handler)` — the last usable in discard
position as `void p.catch(handler)`.

**`.catch` handlers must not be empty.** `.catch(() => {})` satisfies the linter,
satisfies a "no unhandled rejection" test, and preserves the exact defect this
change exists to remove. Every handler routes to the package's existing logging
path. See R-GUARD in Risks for how this is checked rather than trusted.

**Where "return the promise" does NOT apply (React — 70 of the 88 sites).** A
`useEffect` callback must return `void` or a cleanup function; returning a
promise breaks the cleanup contract and React ignores it. DOM/React event
handlers (`onClick`, `onSubmit`) ignore return values entirely. "Return the
promise" is therefore correct for **non-component async helpers whose caller can
own the result** — not for the lifecycle and event paths where most client sites
live. In a `useEffect`, the fix is an inner async function plus `.catch(handler)`
(and a cancellation guard when the result touches state).

### D2 — Install a global rejection handler as the change's regression guard

**Alternatives considered:** (a) respect the proposal's "no new instrumentation"
Non-Goal and handle every site locally; (b) spin it out as a follow-up change;
(c) install it here — chosen, and the Non-Goal is amended in the proposal.

**Rationale:** the proposal's Verification section demanded "a concrete answer to
*how would we know if a discard hid a real failure?*" and no local per-site fix
can supply one. A global handler converts an unfalsifiable claim into a testable
assertion — *no unhandled rejection fires while exercising surface X* — which
E2E can assert directly. It is also the only artifact of this change that keeps
paying off after the 93 sites are fixed.

**Shape:** minimal and loud. Client: `window.addEventListener("unhandledrejection", …)`
at the bundle entrypoint. Electron main: `process.on("unhandledRejection", …)`.
Both log through the package's existing logging path (no new logger). The
handler **must not swallow** — it observes and reports; it never becomes a silent
sink. It is installed **first**, before any site is touched, so the site work can
be validated against it.

### D3 — The split is drawn by risk, not by package name

**Alternatives considered:** (a) keep all `packages/electron` sites here because
the change is named "client and plugin"; (b) move only the 6 misused;
(c) move all 7 electron sites — chosen.

**Rationale:** the previous draft admitted in prose that the electron
main-process sites belonged with the sibling by risk profile, then kept them
anyway because the split had been drawn by package name. Keeping a caveat is not
the same as resolving one. Main-process failure modes (a handler that never
resolves, a lifecycle step that silently skips) match the sibling's
server/extension risk profile, not the client's dropped-user-action profile, and
they warrant the sibling's per-site rigour.

**Consequence:** this change touches zero electron promise sites.
`cleanup-async-semantics-server-extension` must widen its scope from
"server/extension floating" to include electron main (6 misused + 1 floating).
**This is a cross-change dependency and must be recorded in the sibling's
proposal**, or those 7 sites become orphans and `noFloatingPromises` again cannot
graduate — the exact failure this ladder already hit once.

### D4 — Claim the `scripts/` orphan here

`scripts/nightly-verdaccio-serve.mjs:70` (`main();`) sits outside `packages/`
and was owned by no rung. Since the ratchet graduates on repo-root
`biome lint .`, an unowned site is a permanent blocker. One line, claimed here.

### D5 — Classify before editing, and record the classification

Each floating site is triaged into one of the four D1 fixes **before** any edit,
and the choice is recorded. This is `systematic-debugging` applied: establish
what the rejection currently does before deciding how to handle it.

The recorded distribution is a deliverable, not bookkeeping — it is the evidence
`add-typeaware-lint-gate` needs to decide whether `noFloatingPromises` belongs at
`error` or `warn` in `packages/client`. A tally dominated by `.catch(log)` is
evidence for `warn`; one dominated by `await`/`return` is evidence for `error`.

### D6 — Fix the misused sites by narrowing, not by promise handling

The 4 truthiness guards (`client` ×3, `tunnel-core.ts:156`) become explicit
nullish checks. **The narrowing is per-site, not blanket** — the declared types
differ:

| Site | Declared type | Narrowing |
|---|---|---|
| `WorktreeActionsMenu.tsx:48` | `Promise<boolean> \| undefined` | `!== undefined` |
| `useHostPlatform.ts:44` | `… \| null` | `!== null` |
| `useLaunchSource.ts:29` | `… \| null` | `!== null` |
| `tunnel-core.ts:156` | `Promise<string \| null> \| null` | `!== null` |

Applying `!== null` blanket-wise is a TS no-overlap error on the first row. No
`await`, no `.catch` — the memoization semantics are already correct and must be
preserved exactly.

`tunnel-core.ts:167` is different: `new Promise(async (resolve) => { … })`
swallows any throw in the async executor, so the outer promise neither rejects
nor settles. This is a genuine hang-class defect and is fixed by restructuring
the executor (not by suppressing the diagnostic). It gets its own unit test.

### D8 — Test-file floating sites use test-idiomatic fixes

2 of the 70 client floating sites are in
`packages/client/src/lib/__tests__/plugin-config-write.test.ts`. The four
production fixes are the wrong vocabulary there: the idiomatic fix is to return
or `await` the promise in the test body, or assert it via
`await expect(p).rejects/.resolves`. A `.catch(log)` in a test **hides a
failure the test exists to catch** — never use it. Classify test sites
separately and exclude them from the D5 severity tally, which is about product
code.

### D7 — Order of work

1. Global handler (D2) — lands first, so it can observe the rest.
2. Misused sites (D6) — small, mostly mechanical, includes the one real defect.
3. Floating sites (D5), package by package, largest last (`client`, 70).
4. Re-derive both lint counts and assert zero for the claimed scope.

Package-by-package ordering keeps each review chunk reviewable; `review-code`
sees intent per package rather than one 88-site diff.

## Risks / Trade-offs

- **R-GUARD: the regression guard is blind to the failure mode D1 exists to
  prevent.** A swallowing `.catch(() => {})` emits no `unhandledrejection`, so
  the E2E "zero unhandled rejections" assertion goes green while the defect
  survives intact. The guard proves rejections do not *escape*; it does not prove
  they are *handled*. → The E2E assertion is necessary but not sufficient and must
  be paired with: (a) every `.catch` handler routing to the existing logging path,
  (b) a static check that no handler introduced by this change has an empty body,
  and (c) `review-code` reading handler bodies, not just the diagnostic count
  going to zero. Treat a green E2E run alone as insufficient evidence.
- **A green "zero unhandled rejections" run is not attributable to this change
  alone** — it covers all rejections on the exercised surface, including
  pre-existing ones. → Accepted; the assertion is a floor, not proof of the 93
  fixes. Attribution comes from the per-site classification record (D5).
- **The global handler surfaces pre-existing rejections unrelated to this
  change, and CI goes red for reasons nobody expected.** → This is the handler
  working, not failing. Land the handler first (D7 step 1) as its own reviewable
  step so any noise it exposes is attributed correctly, and triage what it finds
  before touching sites. If a pre-existing rejection is out of scope, record it —
  do not silence the handler.
- **`await` added in a React event handler or render path introduces
  update-after-unmount, stale closures, or a lost race.** → `await` is only
  chosen when ordering is load-bearing; default to `.catch(handler)` or returning
  the promise. Per-surface E2E assertions cover the exercised paths.
- **Adding `await` at a call site creates a *new* `noMisusedPromises` finding.**
  → Re-derive both counts together after each package, not once at the end.
- **The 7 electron sites fall through the crack between this change and the
  sibling.** This is not a hypothetical — it was the **actual state** at drafting:
  the sibling Non-Goaled everything outside server/extension and never mentioned
  electron, while the gate table still assigned all 11 misused here. → D3 is only
  discharged once the sibling's proposal and the gate's ownership table are
  updated; both edits are tasks of this change. Verify by confirming the claimed
  sites sum to **143** floating and **11** misused across the ladder.
- **Re-derivation silently undercounts because the extraction pattern misses a
  file extension.** This already happened: a `.ts|.tsx|.mjs|.js|.jsx` filter
  dropped `keeper.cjs:141`, producing 142 and a phantom "duplicate diagnostic"
  that masked the orphan. → Always count from Biome's own diagnostic total, and
  include `.cjs`. Never reconcile a gap by assuming a duplicate.
- **Merge coupling with the sibling on `packages/server` is same-function, not
  just same-file** (this: `tunnel-core.ts:156` narrowing + `:167` executor
  restructure; sibling: floating `promise.finally()` at `:160` — one
  `createTunnel`/`createInner` block). → Whichever lands second re-derives the
  diagnostics for that file rather than assuming the other's patch still applies.
  Restructuring the executor can invalidate the sibling's `:160` fix.
- **93 sites is a large diff and review fatigue is a real failure mode.** →
  Package-by-package sequencing (D7), with the classification record making each
  site's intent legible without re-deriving it from the diff.
- **Banning bare `void` (D1) inflates the diff and may push a reviewer toward
  rubber-stamping.** → Accepted trade-off, chosen deliberately over the smaller,
  weaker option. Mitigated by the same sequencing.

## Migration Plan

Not applicable — no protocol, persistence, or public API change. Rollback is a
revert; the global handler is additive and independently revertible.

## Open Questions

- **Is a floating promise in a React event handler actually a defect?** Left open
  deliberately; the D5 classification tally answers it empirically and feeds
  `add-typeaware-lint-gate`. Not a blocker for this change.
- ~~**Does the sibling accept the 7 electron sites?**~~ Resolved by making it a
  task rather than an assumption: this change edits the sibling's proposal and
  the gate's ownership table to record the handoff. If the sibling's owner later
  rejects it, the 7 sites return here and the split reverts to package-name
  drawing — but the ladder is never left with them unowned.
