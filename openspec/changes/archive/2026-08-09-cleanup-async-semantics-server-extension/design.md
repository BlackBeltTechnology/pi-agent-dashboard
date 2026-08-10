# Design — Clean up async semantics in the server and bridge extension

## Context

This is rung 1a of the local-review-gate ladder. It owns 61 of the repo's
type-aware promise findings: 55 `noFloatingPromises` (extension 37, server 17,
electron 1) and 6 `noMisusedPromises` (electron main). Its sibling
`cleanup-client-plugin-promises` owns the other 88 floating + 5 misused. The
ratchet in `code-quality-loop` graduates on `biome lint .` at repo root, so both
must land before either rule can move off nursery status.

Planning re-derivation overturned the change's original premise. The sites are
**not** concentrated in the hot subsystems the earlier draft named:

| Package | Total | Test-file | Production |
|---|---|---|---|
| `packages/extension` | 37 | 37 | 0 |
| `packages/server` | 17 | 4 | 13 |
| `packages/electron` | 7 | 0 | 7 |
| **total** | **61** | **41** | **20** |

Every extension site is in one of three test files, and the typical one is an
unawaited `bus.request(...)`. That single fact drives most of this design: the
change is two populations with opposite risk profiles, not one hot-path
population.

Constraints carried in:

- **No global rejection handler exists for these processes.** Only
  `packages/server/src/cli.ts:493` (server CLI). The bridge/extension runs in the
  pi-session process; the sibling's new handler covers the client bundle and
  electron main only.
- **`packages/electron` and `packages/server` are edited by both changes.** The
  electron overlap is instrumentation-vs-sites in `main.ts`; the server overlap
  is same-function in `tunnel-core.ts`.

## Goals / Non-Goals

**Goals:**

- Drive `noFloatingPromises` to zero in `packages/extension`, `packages/server`,
  and `packages/electron`; drive `noMisusedPromises` to zero in
  `packages/electron`.
- Do it without serializing a production hot path, proven by the existing load
  harness rather than by argument.
- Do it without weakening any test — a fix that makes a test pass by asserting
  less is the specific regression this change must not ship.

**Non-Goals:**

- Any rule severity flip (`add-typeaware-lint-gate`).
- Any fix in `packages/client`, the plugins, `packages/shell`, or `scripts/`
  (`cleanup-client-plugin-promises`).
- `noMisusedPromises` in server/extension — the 2 server misused sites
  (`tunnel-core.ts:156,167`) belong to the sibling. Electron misused is the
  documented exception.
- Installing the global unhandled-rejection handler, including the electron-main
  one — the sibling owns it.
- Redesigning the message pump, converting callback paths to promises, or adding
  instrumentation.

## Decisions

### D1 — Fix vocabulary is set by file kind, and bare `void` is banned

**Alternatives considered:** (a) one vocabulary for all 61 sites, as the earlier
draft had; (b) permit `void`-with-reason in production hot paths only; (c) ban
bare `void` everywhere and split the vocabulary by file kind — chosen.

| File kind | Allowed fixes |
|---|---|
| test files (38) | `await`, `return` — nothing else |
| non-promise inference artifacts (3, see D7) | a `: void` return annotation — never `await` |
| production (20) | `await`, `return`, `Promise.all` / `allSettled`, `.catch(handler)` |

**Rationale.** In production the ban matches the sibling and rests on the same
durable argument: **intent at the call site**. The weaker claim — "a bare `void`
is genuinely unobserved" — is *false for the server main process*:
`packages/server/src/cli.ts:493` installs a crash-safety net that logs
`"[crash-safety] unhandledRejection (suppressed)"`. A bare `void` there is
observed, but anonymously, with no owner and no remediation. On the worker
threads (`session-load-worker-pool.ts`, `openspec-poll-worker-pool.ts`) it is
plausibly not observed at all. Either way the net records that a rejection
escaped without recording that the author considered it. A discard is written
`void p.catch(handler)` with a non-empty handler routed to the existing logging
path.

In test files the ban is stronger, for a different reason: `void` and `.catch`
**suppress the failure the test exists to detect**. A rejected promise in a test
should fail that test. So test sites get `await` or `return` only.

Consistency with the sibling matters here beyond taste — the two changes edit the
same files (`main.ts`, `tunnel-core.ts`), and divergent discard conventions in one
file would be visible as inconsistency for no reason.

### D2 — Two falsifiable oracles replace the withdrawn invariant

The earlier invariant, "no intended change to observable product behaviour", is
withdrawn: *intended* is author-internal, so nothing can fail it.

1. **Regression floor — not a coverage oracle.**
   `packages/server/src/__tests__/browser-gateway-load.test.ts` (scenario matrix
   A–E over the real `createBrowserGateway`, `broadcastEvent`,
   `broadcastOpenSpecUpdate`, and the backpressure guard — it does **not** call
   `broadcastToAll`, which appears only in its header comment).

   An earlier draft of this design claimed it "covers the broadcast-adjacent
   sites". **Re-derivation against the harness source refutes that.** The harness
   sends exactly one inbound message, `{ type: "subscribe" }`
   (`helpers/load-fixtures.ts:150`), and never calls `start()`. Consequently:

   | Site | Why the harness never exercises it |
   |---|---|
   | `directory-handler.ts:226,247` | reached only via `openspec_refresh` / `openspec_bulk_archive` messages, never sent |
   | `browser-gateway.ts:621` | reached only via a `shutdown` message, never sent |
   | `server.ts:2144,2180` | server boot path; `start()` is never called |
   | `subscription-handler.ts:220,243,249` | runs as empty-replay **setup**, before the window the flush-budget assertions measure |

   So a wrongly-added `await` at **any** of the 13 production sites cannot fail
   this harness. It must not regress, but a green run is close to no evidence
   about this change. Where a site genuinely sits in a measured hot path, the fix
   is to **extend the harness to exercise that path** — a per-site task, not an
   assumption.
2. **Per-site behavioural assertions carry all 13 production sites.** Not the
   5-file remainder an earlier draft implied — finding (1) collapses the
   harness-covered population to roughly zero, so this oracle is doing
   essentially all of the work. Each fix carries an assertion that the rejection
   is now observed, and that any ordering the fix relies on actually holds.

For the 38 real test-file sites the oracle is **the test still proves what it
proved** (D3). The 3 `withPiResolve` sites are not promises at all and take a
`: void` annotation instead (D7).

### D3 — Test-file sites: preserve what the test proves

The dominant extension pattern is fire-then-assert:

```ts
bus.registerAdapter(good);
bus.request({ pipeline: "command", type: "select", … });   // floating
// …then assert on adapter state
```

Adding `await` here can **change what the test proves** — it may serialize a
request the test deliberately left in flight, or hang to the Vitest timeout if
nothing resolves it.
So each test site is triaged:

- **Missing await on an assertion** → add `await` / `return`. The common case and
  a genuine latent bug.
- **Deliberately in flight** → capture the promise and await it **after** the
  assertions, preserving the interleaving the test depends on:

  ```ts
  const p = bus.request({ … });        // was floating
  expect(adapter2.onRequest).toHaveBeenCalled();
  await p;                             // settle before the test ends
  ```

  Match the settle to the promise's actual polarity. The typical site here
  **resolves** (a mock adapter answers it), so `await expect(p).rejects…` would
  fail and change what the test proves — the exact regression this decision
  forbids. Use `.rejects` only where rejection is genuinely expected.

  Two traps: capture-and-await-later still surfaces an `unhandledRejection` if
  the promise rejects during an intermediate `await`, so it is safe only for
  resolving promises or when the settle closely follows; and a request that
  **never settles** has no vocabulary-legal fix — awaiting hangs the test to the
  Vitest timeout, and `.catch` is banned in tests. Those sites need the adapter
  made to answer, and are flagged rather than forced.

**A fix that makes the diagnostic disappear while weakening the assertion is a
regression, not a fix.** Before/after, each touched test must still fail when the
behaviour it covers is broken — verified by mutating the behaviour and confirming
the test goes red.

### D4 — The inherited electron misused sites need a vocabulary this change did not have

The 6 sites are two distinct shapes, neither covered by `await`/`.catch`:

| Site | Shape | Fix |
|---|---|---|
| `lib/server-lifecycle.ts:454` (`Promise<LaunchOutcome> \| null`) | promise-in-conditional inflight guard | narrow — `!== null` |
| `lib/doctor-window.ts:52` (`Promise<DoctorReport> \| null`) | promise-in-conditional inflight guard | narrow — `!== null` |
| `main.ts:531,557,607,654` | `async function quit(): Promise<void>` (`main.ts:469`) passed as `createTray`'s `onQuit: () => void` (`lib/tray.ts:86`) | wrap: `() => { void quit().catch(<handler>); }` |

**These four are the same call** — `createTray(() => mainWindow, quit, { … })` —
repeated at four sites. Fix the pattern once and apply it four times, or widen
`createTray`'s `onQuit` type to accept an async callback and handle it inside
`tray.ts`, which clears all four from one place. Do not hand-roll four different
wrappers.

**The wrapper must respect D1.** "Make the handler sync" is infeasible — `quit`
awaits `stopServerIfNeeded()`. And the natural wrap `() => { void quit(); }` is
**bare `void`, which D1 bans**. The legal form is
`() => { void quit().catch(<handler>); }`. D1 and D4 must be read together here;
an implementer following D4 alone produces this change's own prohibited pattern.

The two guard sites are the same memoization pattern the sibling fixes by
narrowing; narrowing is `!== null` for both (unlike the sibling's
`WorktreeActionsMenu`, which is `| undefined`). Prefer narrowing over `await` for
**minimality**, not because awaiting would break dedupe — dedupe is decided by
the guard itself, and `return await inflight` would cost only an extra microtask.

### D5 — Cross-change coupling is same-function, not same-file

Two overlaps with `cleanup-client-plugin-promises`:

- **`tunnel-core.ts`** — this change fixes the floating `promise.finally()` at
  `:160`; the sibling narrows `:156` and restructures the async executor at
  `:167`. All three sit in the same `createTunnel`/`createInner` block, and the
  executor restructure can invalidate the `:160` patch. Whichever lands second
  **re-derives the diagnostics for that file** rather than assuming its patch
  still applies.
- **`electron/src/main.ts`** — this change fixes sites at `:531,557,607,654,675`;
  the sibling installs the global rejection handler in the same file. Additive,
  but they will conflict textually.

Neither change may assume the other's state.

### D6 — Order of work

1. The 3 `withPiResolve` annotation sites (D8) — smallest, and it establishes
   early that the vocabulary bends to the sites rather than the reverse.
2. Test-file sites (38) — isolated from production risk, and they exercise the D3
   triage while the classification habit is forming.
3. Production server sites, each with its per-site assertion (D2 oracle 2). There
   is no "harness-covered first" sub-order, because the harness covers none of
   them; order by file instead.
4. Inherited electron sites (D4), fixing the `createTray` pattern once.
5. Re-derive both rules and confirm the claimed 61 are clear.

Test files first is deliberate: they are the larger population, the lower risk,
and getting the D3 triage wrong is cheap to detect and correct.

### D7 — Three "test sites" are not promises and take a different fix

`withPiResolve` in `__tests__/pi-resource-activation-timeout.test.ts:22` has **no
return statement** — it configures a mock and returns `undefined`. The three
diagnostics at `:46,59,65` are a type-inference artifact, not floating promises.

Applying D1's test vocabulary would produce `await withPiResolve(...)` —
`await undefined`, a no-op that documents a defect that does not exist and
misleads the next reader. The fix is a `: void` return annotation on the helper,
which clears all three diagnostics.

This bucket exists because a fix vocabulary derived from a rule name rather than
from the sites will mis-handle sites the rule flags for a different reason.
Treat any remaining site whose "promise" turns out not to be one the same way.

### D8 — Record the classification

Each site's chosen fix is recorded, as in the sibling. Two consumers: the
`add-typeaware-lint-gate` severity decision, and `review-code`, which needs to
see intent per site rather than infer it from a 61-site diff.

## Risks / Trade-offs

- **A test fix removes the diagnostic and the test's teeth at the same time.**
  The highest-likelihood failure in this change, because it is invisible in a
  green run. → D3's mutation check: break the covered behaviour and confirm the
  touched test fails. Applied to the test sites, not just asserted.
- **Passing the load harness is mistaken for proof that nothing serialized.**
  This was the original design's own error: it named four files as
  "harness-covered" when the harness executes none of their sites. → D2 states
  the coverage gap explicitly. The per-site assertions are not optional extras —
  they are the only real oracle for all 13 production sites.
- **An added `await` serializes a production hot path and nothing catches it.**
  → Prefer `.catch(handler)` over `await` unless ordering is demonstrably
  load-bearing; where a site is genuinely in a measured hot path, extend the
  harness to exercise it rather than assuming coverage.
- **`await` added at a call site creates a new `noMisusedPromises` finding.** →
  Re-derive both rules together after each group, not once at the end.
- **`tunnel-core.ts` / `main.ts` rebase against the sibling.** → D5; re-derive
  rather than assume.
- **38 test-file sites in four files make a large, monotonous diff and invite
  rubber-stamping.** → Group by file and by triage outcome (missing-await vs
  deliberately-in-flight) so a reviewer can check the reasoning per group.
- **Extraction filters drop `keeper.cjs:141`.** A `.ts/.js`-only filter
  undercounts server by one — this already happened once on the ladder and
  produced a phantom "duplicate diagnostic". → Count from Biome's reported total;
  include `.cjs`.

## Migration Plan

Not applicable — no protocol, persistence, or public API change. Rollback is a
revert; the change is a set of independent per-site edits with no shared state.

## Open Questions

- **Which extension test sites were deliberately left in flight?** A per-site
  judgement made during implementation under D3, not a planning blocker.
- **Do the 4 server test-file sites share the fire-then-assert pattern**, or are
  they plain missing awaits? Triaged the same way; noted because
  `pi-resource-activation-timeout.test.ts` is timing-sensitive by name and may be
  the one place where awaiting genuinely changes the test.
