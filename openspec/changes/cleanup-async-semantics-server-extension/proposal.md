# Clean up async semantics in the server and bridge extension

## Why

This change owns **55 floating + 6 misused** sites: `packages/extension` (37
floating), `packages/server` (17 floating), and 7 `packages/electron`
main-process sites handed over from `cleanup-client-plugin-promises` (1 floating
at `main.ts:675`; 6 misused at `main.ts:531,557,607,654`,
`lib/server-lifecycle.ts:454`, `lib/doctor-window.ts:52`).

### The sites are not where the earlier draft said they were

The pre-planning draft justified this change as "the WebSocket message pump, the
PTY/terminal paths, session spawn, and the process tracker — the hottest
subsystems the project has", and called it "the highest-risk change in the
ladder". **Re-derivation shows that is false.** The actual split by file kind:

| Package | Total | Test-file sites | Production sites |
|---|---|---|---|
| `packages/extension` | 37 | **37** | **0** |
| `packages/server` | 17 | 4 (3 of them non-promises — see below) | 13 |
| `packages/electron` | 1 floating + 6 misused | 0 | 1 + 6 |
| **total** | **61** | **41** | **20** |

All 37 extension sites live in three test files — `__tests__/prompt-bus.test.ts`
(17), `__tests__/prompt-bus-wiring.test.ts` (14),
`__tests__/tui-prompt-adapter.test.ts` (6) — and the typical site is an
unawaited `bus.request(...)`. There is **no bridge message pump, RPC dispatch,
heartbeat watchdog, or auto-namer site in `packages/extension`.** That
qualifier matters: `packages/server/src/pairing/browser-gateway.ts:621` *is* a
WS message-dispatch site (`case "shutdown": handleShutdown(...)`, and
`handleShutdown` is async), so the earlier draft's "message pump" framing was
wrong about the extension but not about the server.

The 4 server test sites are `__tests__/pi-resource-activation-timeout.test.ts`
(3) and `embed-lifecycle/__tests__/visitor-session-registry.test.ts` (1).

**3 of those 4 are not floating promises at all.** `withPiResolve` in
`pi-resource-activation-timeout.test.ts:22` has **no return statement** — it
returns `undefined`. The diagnostics at `:46,59,65` are a type-inference
artifact, and the vocabulary-legal fix (`await withPiResolve(...)`) would be
`await undefined`: a no-op documenting a defect that does not exist. The correct
fix is a `: void` return annotation on the helper, which is **outside** the
fix vocabulary below and is called out as its own bucket.

So this is **20 production decisions and 41 test-file decisions**, not 61
hot-path decisions. The two kinds need different conventions, and are tasked
separately below. `cleanup-client-plugin-promises` — 70 real client sites — is the
higher-risk change of the pair; this one no longer claims that title.

The production sites are still worth care. They sit in session lifecycle,
process management, the browser gateway, worker pools, tunnel, and recovery —
and a silent unhandled rejection there is the failure signature `debug-dashboard`
describes (a session that never registers, a restart loop, a spawn that yields no
card). But that argument covers 13 server files, not 37 extension ones.

| Fix | Risk if wrong |
|---|---|
| `await` it | in a production hot path, serializes it — can stall the broadcast path or a worker pool |
| bare `void` | silences a rejection that should surface — makes the bug *less* diagnosable. **Banned by this change.** |
| `.catch(handler)` | correct default, but wrong if the caller must observe failure |

In a **test file** the calculus inverts: a floating promise is usually a missing
`await` on the assertion itself, and `void` / `.catch` would hide the very
failure the test exists to catch. Test sites take `await` or `return` only.

> Counts re-probed over the whole `packages/` tree after doubt-driven-review
> cycle 1 on the sibling change (the earlier draft said 53 / server 16), and the
> production-vs-test split re-derived during this change's own planning.

## What Changes

- **Fix 37 `noFloatingPromises` findings in `packages/extension/src/__tests__/`**
  — all three files are test files; the fix vocabulary is `await` / `return`, not
  `void` / `.catch`. Where the unawaited call was deliberate (fire the request,
  then assert on adapter state), make that explicit rather than awaiting and
  changing what the test proves.
- **Fix 13 production `noFloatingPromises` findings in `packages/server/src`** —
  `browser-handlers/subscription-handler.ts` (3), `server.ts` (2),
  `browser-handlers/directory-handler.ts` (2), and one each in
  `tunnel/tunnel-core.ts`, `session/session-load-worker-pool.ts`,
  `rpc-keeper/keeper.cjs`, `pairing/browser-gateway.ts`,
  `openspec/openspec-poll-worker-pool.ts`, `lifecycle/recovery-server.ts`. Note
  `keeper.cjs:141` is a `.cjs` file, easily missed by an extraction filter that
  only matches `.ts/.js`.
- **Fix 1 test-file `noFloatingPromises` finding** in
  `embed-lifecycle/__tests__/visitor-session-registry.test.ts`, using the test
  vocabulary below.
- **Annotate `withPiResolve` in
  `__tests__/pi-resource-activation-timeout.test.ts` with `: void`** — clearing
  the 3 inference-artifact diagnostics at `:46,59,65` without pretending they
  were promises. Do **not** `await` them.
- **Fix 1 `noFloatingPromises` + 6 `noMisusedPromises` findings in
  `packages/electron/src`** (main process) — handed over from
  `cleanup-client-plugin-promises`. Apply this change's per-site rigour, not the
  client's. Note `cleanup-client-plugin-promises` still installs the global
  unhandled-rejection handler in electron main; that is instrumentation, not a
  site fix, and the two must be rebased against each other in `main.ts`.
- **Extend the fix vocabulary for the inherited misused sites.** The
  `await` / `void` / `.catch()` scheme below does **not** cover them; applying it
  would be wrong:

  | Inherited site | Actual shape | Correct fix |
  |---|---|---|
  | `lib/server-lifecycle.ts:454` (`Promise<LaunchOutcome> \| null`) | promise-in-conditional inflight guard | **narrow** — `!== null` |
  | `lib/doctor-window.ts:52` (`Promise<DoctorReport> \| null`) | promise-in-conditional inflight guard | **narrow** — `!== null` |
  | `main.ts:531,557,607,654` | async callback passed where `() => void` expected | wrap the callback, or make the handler sync and handle the promise inside |

  The two guard sites are the same pattern `cleanup-client-plugin-promises`
  fixes by narrowing; they are behaviour-preserving and must not be `await`ed.
- **Classify every site before editing it**, with the vocabulary set by the file
  kind. **Bare `void` is banned**, aligning with
  `cleanup-client-plugin-promises`; a discard is written
  `void p.catch(handler)` with a non-empty handler.

  | File kind | Allowed fixes |
  |---|---|
  | test files (38 sites) | `await`, `return` — nothing else. `void` / `.catch` would hide the failure the test exists to catch. |
  | non-promise inference artifacts (3 sites) | a `: void` return annotation on the helper — never `await` |
  | production (20 sites) | `await`, `return`, `Promise.all` / `allSettled`, `.catch(handler)` |

  The ban is justified by **intent at the call site**, not by "nobody would see
  it" — that weaker claim is false for the server main process. `packages/server/src/cli.ts:493`
  installs a crash-safety net that logs
  `"[crash-safety] unhandledRejection (suppressed)"`, so in the server main
  process a bare `void` *is* observed, just anonymously and with no owner. It is
  plausibly **not** observed on the worker threads
  (`session-load-worker-pool.ts`, `openspec-poll-worker-pool.ts`), which do not
  necessarily route to that handler. A net records that a rejection escaped; it
  cannot record that the author considered it.
- **The load harness is a regression floor, not an oracle for these sites.**
  `packages/server/src/__tests__/browser-gateway-load.test.ts` drives real
  gateway code (`createBrowserGateway`, then `broadcastEvent` and
  `broadcastOpenSpecUpdate` — note it does **not** call `broadcastToAll`, which
  appears only in its header comment). But re-derivation against the harness
  source shows it exercises **almost none of this change's production sites**:
  it sends exactly one inbound message, `{ type: "subscribe" }`, and never calls
  `start()`. Therefore `directory-handler.ts:226,247` (need `openspec_refresh` /
  `openspec_bulk_archive`),
  `browser-gateway.ts:621` (needs `shutdown`), and `server.ts:2144,2180` (boot
  path) are never executed; `subscription-handler.ts:220,243,249` run only as
  empty-replay setup, before the window the assertions measure. A wrongly-added
  `await` at any of them cannot fail this harness. It must not regress — but
  passing it is close to no evidence about this change. See Verification.
- **No severity flips.** As with the sibling, turning the rule on belongs to
  `add-typeaware-lint-gate`.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — discharges the remaining half of the ratchet's
  "cleanup lands first" precondition for `noFloatingPromises`.

## Non-Goals

- Any rule severity flip (`add-typeaware-lint-gate`).
- Any fix outside `packages/server`, `packages/extension`, and
  `packages/electron` (`cleanup-client-plugin-promises`).
- **`noMisusedPromises` in server/extension.** This change owns *floating*
  promises in server/extension; the 2 server misused-promise sites belong to
  `cleanup-client-plugin-promises`. The **electron** misused sites (6) are the
  one exception — they are owned here, by the handoff described in Why.
- Installing the global unhandled-rejection handler
  (`cleanup-client-plugin-promises` owns it, including the electron-main one).
- Dependency declarations (`cleanup-undeclared-dependencies`) and import cycles
  (`cleanup-import-cycles`).
- Fixing `tunnel-core.ts:156` or `:167` — `cleanup-client-plugin-promises` owns
  those. **But note they sit in the same `createTunnel`/`createInner` block as
  this change's floating fix at `:160`.** The coupling is same-function, not
  merely same-file: that change restructures the async executor at `:167`, which
  can invalidate the `:160` patch. Whichever change lands second must re-derive
  the diagnostics for `tunnel-core.ts` rather than assume its patch still
  applies.
- Refactoring the async architecture. This change fixes unhandled rejections; it
  does not redesign the message pump, and it does not convert callback paths to
  promises.
- Adding observability. Where a `.catch()` needs a logger and none exists, use
  the existing logging path — new instrumentation is out of scope.

## Impact

- `packages/extension/src/__tests__/**` — 37 sites, all test files.
- `packages/server/src/**` — 17 sites (13 production, 4 test).
- `packages/electron/src/**` — 1 floating + 6 misused, all main process.
- **Behaviour risk is real but narrower than the earlier draft claimed**: an
  incorrectly-added `await` in the broadcast path or a worker pool changes
  ordering and can stall a live session. That risk applies to the 13 production
  server sites and the electron main sites — not to the 41 test-file sites, where
  the risk is instead that a fix changes what the test proves.
- No protocol, persistence, or public API change intended.

## Open Questions

**Resolved during planning:**

- ~~Is there an existing rejection handler these promises fall through to?~~
  **Partly.** `packages/server/src/cli.ts:493` installs a crash-safety net in the
  server main process, which logs and suppresses unhandled rejections — so a bare
  `void` there **is** observed, anonymously. The extension (pi-session process)
  has none, and the worker threads plausibly do not route to the server's
  handler. The sibling's new handler covers the client bundle and electron main
  only.
- ~~Should `void` be permitted at all here?~~ **Bare `void` is banned**, aligning
  with `cleanup-client-plugin-promises`. Discards are `void p.catch(handler)`.
  Test files are stricter still: `await` / `return` only. The ban rests on
  **intent at the call site**, not on the rejection being unobserved —
  `cli.ts:493` does observe them in the server main process.
- ~~Are these the hottest subsystems in the project?~~ **No** — 37 of the 61 sites
  are extension test files and 4 more are server test files. See the table in
  Why. The change no longer claims to be the ladder's highest-risk rung.
- ~~Do the load harnesses actually cover the touched paths?~~ **Essentially not
  at all.** `browser-gateway-load.test.ts` sends only `{ type: "subscribe" }` and
  never calls `start()`, so 10 of the 13 production sites never execute and the
  other 3 run outside the measured window. The earlier "covers the
  broadcast-adjacent sites" answer was wrong and is withdrawn. The harness is a
  regression floor; the per-site assertions are the real oracle.

**Still open:**

- **Was each unawaited call in the extension test files deliberate?** Some fire a
  request and then assert on adapter state; adding `await` there changes what the
  test proves rather than fixing a defect. This is a per-site judgement made
  during implementation, not a blocker.

## Verification

The earlier invariant — "no intended change to observable product behaviour" — is
**withdrawn as unfalsifiable**: it turns on the author-internal word *intended*,
no test can fail it, and these sites have no baseline behaviour spec. Two
falsifiable oracles replace it:

1. **The load harness is a regression floor, not a coverage oracle.**
   `browser-gateway-load.test.ts` must not regress. But its measured window does
   not execute 10 of this change's 13 production sites at all, and runs the other
   3 (`subscription-handler.ts:220,243,249`) only as empty-replay setup, outside
   the window its assertions measure — so **it proves nothing about any of them**
   (see What Changes). Treating a green harness run as evidence
   that no `await` serialized a hot path would be exactly the false comfort this
   Verification section exists to remove. Where a site genuinely sits in a
   measured hot path, the honest move is to **extend the harness to exercise it**
   — tasked per site, not assumed.
2. **Per-site behavioural assertions carry all 13 production sites**, not the
   5-file remainder an earlier draft implied. Each fix carries an assertion that
   the rejection is now observed, and that any ordering the fix relies on holds.

For the 41 test-file sites the oracle is different in kind: the **test still
proves what it proved before**. A fix that makes a test pass by asserting less is
a regression, and is the specific failure mode to guard against.

`scenario-design` derives both oracles into `test-plan.md`.

## Discipline Skills

- `systematic-debugging` — the classification pass is evidence-first: determine
  what each promise's rejection currently does before deciding how to handle it.
- `review-code` — 61 decisions (20 production + 41 test-file); the production
  ones need a reviewer that can see intent, not just the diff, and the test-file
  ones need a reviewer checking that each test still proves what it proved.
- `performance-optimization` — the "did an `await` serialize a hot path"
  question is a measured one; use the existing WS load harness as the oracle
  rather than reasoning about it.
- `observability-instrumentation` — a `.catch()` that swallows silently is the
  same defect wearing a different hat; rejections must land somewhere visible.
- `doubt-driven-review` — before the classification convention stands, stress it;
  it decides 61 edits and is expensive to revisit afterwards. It already caught
  that this change's stated risk profile did not match its actual sites.
