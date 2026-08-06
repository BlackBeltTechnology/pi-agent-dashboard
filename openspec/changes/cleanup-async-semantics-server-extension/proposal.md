# Clean up async semantics in the server and bridge extension

## Why

54 floating promises sit in the two packages where "fire and forget" is least
safe: `packages/extension` (37) and `packages/server` (17), plus **7
`packages/electron` main-process sites handed over from
`cleanup-client-plugin-promises`** (1 floating at `main.ts:675`; 6 misused at
`main.ts:531,557,607,654`, `server-lifecycle.ts:454`, `doctor-window.ts:52`) —
**55 floating + 6 misused in total** (37 + 17 + 1 floating; 6 misused). Electron
main was moved here because the
split is drawn by *blast radius*, not package name: a main-process handler that
never resolves matches this change's risk profile, not the client's
dropped-user-action profile. These are the
WebSocket message pump, the PTY/terminal paths, session spawn, and the process
tracker — the exact subsystems `debug-dashboard` exists to unstick, and the exact
failure signature its FAQ describes (silent unhandled rejection → a session that
never registers, a restart loop, a spawn that yields no card).

This is deliberately a **separate change** from `cleanup-client-plugin-promises`,
which owns the same rule outside these two packages. The split is by blast
radius, not by rule: every site here is a semantic decision with three different
wrong answers, made in the hottest subsystems the project has:

| Fix | Risk if wrong |
|---|---|
| `await` it | serializes a hot path; can deadlock a PTY read or stall the message pump |
| `void` it | silences a rejection that should surface — makes the bug *less* diagnosable, not more |
| `.catch(log)` | correct default, but wrong if the caller must observe failure |

A blanket codemod across these 54 sites would be a regression generator. The
change therefore treats each site as a reviewed decision with a recorded
rationale, not as a lint-satisfying edit.

> Counts re-probed over the whole `packages/` tree after doubt-driven-review
> cycle 1 on the sibling change; the earlier draft said 53 (server 16).

## What Changes

- **Fix 37 `noFloatingPromises` findings in `packages/extension/src`** — the
  bridge message pump, RPC dispatch, session-state poll, heartbeat watchdog, and
  auto-namer paths.
- **Fix 17 `noFloatingPromises` findings in `packages/server/src`** — session
  lifecycle, process management, tunnel, and persistence paths. Note one site is
  `rpc-keeper/keeper.cjs:141` — a `.cjs` file, easily missed by an extraction
  filter that only matches `.ts/.js`.
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
  | `server-lifecycle.ts:454` (`Promise<LaunchOutcome> \| null`) | promise-in-conditional inflight guard | **narrow** — `!== null` |
  | `doctor-window.ts:52` (`Promise<DoctorReport> \| null`) | promise-in-conditional inflight guard | **narrow** — `!== null` |
  | `main.ts:531,557,607,654` | async callback passed where `() => void` expected | wrap the callback, or make the handler sync and handle the promise inside |

  The two guard sites are the same pattern `cleanup-client-plugin-promises`
  fixes by narrowing; they are behaviour-preserving and must not be `await`ed.
- **Classify every site before editing it.** Each fix is one of `await`
  (ordering is load-bearing), `void` (genuinely fire-and-forget AND rejection is
  already handled downstream), or `.catch(<handler>)` (rejection must be
  observed/logged). `void` requires a stated reason — it is the only option that
  can hide a defect.
- **Prove the hot paths did not serialize.** The WS broadcast and message-pump
  paths carry existing load harnesses (`ws-broadcast-load-harness`); a fix that
  regresses their throughput is rejected, not merged.
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

- `packages/extension/src/**` — 37 sites, concentrated in the bridge.
- `packages/server/src/**` — 17 sites.
- **Behaviour risk is real and asymmetric**: an incorrectly-added `await` inside
  the WS message pump or a PTY read loop changes ordering and can stall a live
  session. This is the highest-risk change in the ladder.
- No protocol, persistence, or public API change intended.

## Open Questions

- **This change is deliberately behaviour-changing, and that is the point.**
  `await` serializes and surfaces errors; `.catch()` adds handling that did not
  exist; `void` documents a discard. The invariant to hold is "no intended change
  to observable product behaviour" — not "behaviour-preserving", which is false
  for every site here.
- **Should `void` be permitted at all here?** Banning it forces every site to
  either await or handle, which is safer but larger. Permitting it keeps the diff
  small but re-hides exactly the class of bug this change exists to surface.
- ~~**Is there an existing rejection handler these promises already fall through
  to?**~~ **Answered — no, and it invalidates the `void` option for the extension.**
  Investigation during `cleanup-client-plugin-promises` planning found the only
  source-level `unhandledRejection` listener in the repo is
  `packages/server/src/cli.ts:493`, which runs in the **server CLI process**. The
  bridge/extension runs in the **pi-session process** and has none. The sibling's
  new global handler covers the **client bundle and electron main only** — not
  this process. So `void` gated on "rejection is already handled downstream" is
  **unavailable for all 37 extension sites**; there is no downstream. Revisit the
  `void` question above with that constraint. (The sibling resolved the same
  question by banning bare `void` outright and requiring `void p.catch(handler)`.
  Diverging from that here is allowed, but should be a decision, not an
  oversight.)
- **⚠ This change has no Verification section, and its stated invariant is not
  falsifiable.** "No intended change to observable product behaviour" turns on
  the author-internal word *intended*; no test can fail it, and these sites have
  no baseline behaviour spec. The WS load harness is a *serialization* oracle
  only — it does not cover rejection handling. This change needs its own
  `scenario-design` pass to produce a `test-plan.md` before it reaches a
  worktree. Raised from `cleanup-client-plugin-promises` planning; not fixed here
  because it belongs to this change's own planning cycle.
- **Do the load harnesses actually cover the touched paths**, or do they need
  extending before they can serve as the no-serialization oracle?

## Discipline Skills

- `systematic-debugging` — the classification pass is evidence-first: determine
  what each promise's rejection currently does before deciding how to handle it.
- `review-code` — 61 semantic decisions (55 floating + 6 inherited misused) in
  the highest-risk subsystems; every one
  needs a reviewer that can see intent, not just the diff.
- `performance-optimization` — the "did an `await` serialize a hot path"
  question is a measured one; use the existing WS load harness as the oracle
  rather than reasoning about it.
- `observability-instrumentation` — a `.catch()` that swallows silently is the
  same defect wearing a different hat; rejections must land somewhere visible.
- `doubt-driven-review` — before the classification convention stands, stress it;
  it decides 61 edits and is expensive to revisit afterwards.
