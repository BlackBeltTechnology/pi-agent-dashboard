# Design — guard the server heap against the store budget

## Context

`bound-session-heap-and-gc-telemetry` lowers the dashboard server ceiling to
`1536`, derived from a 768 MiB store budget plus a ~112 MB baseline. Three
mechanisms that protect that derivation were scoped out of it because they key
on `maxTotalEventBytes`, which only exists once `bound-event-store-by-bytes`
merges. They are collected here, together with two stamp-reach defects found in
the same review.

Inherited decisions (not re-litigated): the `1536` value itself, its ~84%
occupancy trade-off, and the argv-over-`NODE_OPTIONS` transport.

## Decisions

### D1 — The guard predicate is pinned, not left to the implementer

Two formulas satisfy the obvious pinned points (`0` warns, `768` silent, `2048`
warns) yet diverge in the middle of the range, so the predicate is fixed:

```
budgetMiB × HEAP_MB_PER_BUDGET_MIB + BASELINE_MB > ceilingMB × CRASH_RATIO
where budgetMiB = maxTotalEventBytes / 1024²
```

`HEAP_MB_PER_BUDGET_MIB = 1.33`, `BASELINE_MB = 112`, `CRASH_RATIO = 0.82`,
exported once from shared.

**The conversion is part of the pinned predicate, not an implementer detail.**
`maxTotalEventBytes` is byte-denominated in `MemoryLimitsConfig` (the settings
field is labelled in MiB and converts at the edge), while every term above is
MB/MiB. Feeding the raw byte value in makes the predicate warn on the default
pairing — `805306368 × 1.33 + 112 > 1259` — i.e. the guard fires permanently and
looks like it works. The guard therefore takes **bytes** at its boundary and
divides once, internally; the constant is named `_PER_BUDGET_MIB` so the unit is
visible at every call site.

`maxTotalEventBytes: 0` short-circuits to "warn" on **semantic** grounds — `0`
means unlimited, so there is no budget to put through the arithmetic. (The
earlier justification, "no finite budget satisfies the comparison", is simply
false: small budgets satisfy it.) The warning describes the store as *unbounded*
rather than reporting a heap figure — there is no finite number to report.

Note the ceiling term is the **request**, not the limit: V8 grants roughly
`request + 192 MB`, so this predicate is deliberately conservative by about that
margin. That is the intended direction for a tripwire.

### D2 — The invariant checks boundedness, not presence

A build-time assertion in shared fails when the server default is below `8192`
while `DEFAULT_MEMORY_LIMITS` carries no `maxTotalEventBytes` **or** carries a
`0`. Presence alone would pass the unlimited default, which is precisely the
configuration the guard exists to catch.

A runtime probe was rejected: the standalone wrapper runs before jiti and cannot
import the store to ask whether a bound is in effect, so a runtime gate would
miss the path that most needs it.

**Which default the assertion reads — and who owns consolidating it.** An
earlier draft of this design had the change consolidate three `8192` literals
itself. That is *already the sibling's work*: `bound-session-heap-and-gc-telemetry`
D8 has `bin/pi-dashboard.mjs` parse `~/.pi/dashboard/config.json` directly
(pre-jiti, so it cannot import TypeScript), and its task 8.5 asserts the wrapper
literal against the shared config default. Re-doing it here would collide.

This change therefore **reads** the sibling's default and adds only the split
the client forces: the ceiling default must be importable as a **value** from
`packages/client`, and `config.ts` imports `node:fs`/`node:os`/`node:path` at
module scope — a value import from the browser bundle kills the SPA at boot with
`uv.homedir is not a function` (the documented reason `memory-limits.ts` exists
at all). So the numeric default lives in a browser-safe module and `config.ts`
re-exports it, exactly as `DEFAULT_MEMORY_LIMITS` already does. One definition,
two importers; the invariant and the client guard read the same constant the
launcher stamps, which is the drift this pinning exists to prevent.

**Mechanism, pinned:** the assertion is a **vitest assertion in shared's test
suite**, not a module-scope `throw`. A module-scope assert in a browser-imported
module would brick the SPA on a mispairing instead of failing CI — turning a
build-time guard into a production outage. "Build-time" here means "fails the
CI gate before merge", and the test must be shown to fail closed (a vacuous
assertion proves nothing).

### D3 — Electron is the third launch path

`packages/electron/src/lib/launch-source.ts` calls `launchDashboardServer` with
a hand-built env carrying no heap flag, so an Electron-spawned server runs at
the runtime default — neither the old `8192` nor the new `1536`. It gains the
same stamp the other two paths use.

**Where the Electron main process gets the value:** it reads
`~/.pi/dashboard/config.json` directly, with the same `JSON.parse`-inside-a-`try`
shape sibling D8 gives the standalone wrapper, falling back to the shared
default on any failure. Electron main is a Node context, so the browser-safe
constraint does not bind it — but matching the wrapper's shape keeps one
reading rule across the launch paths instead of two that drift.

Under the sibling's argv transport, argv **outranks** `NODE_OPTIONS` (measured).
So the Electron stamp must suppress itself when an operator pin is already
present; otherwise "SHALL NOT override an operator-pinned flag" is violated by
construction — the stamp would win silently even with the operator's value
untouched in the environment.

### D5 — `/api/restart` re-stamps, rather than silently un-stamping

A stamp that only survives a cold start is close to useless in this repo, whose
own workflow restarts the server after every server-side change.
`restart-helper.ts:102` builds `spawnArgs` from the CLI arguments alone and
never carries `process.execArgv`, so an argv-borne ceiling is dropped on every
`/api/restart` — on *all* launch paths, not just Electron. The respawn therefore
re-applies the configured ceiling to `spawnArgs`.

**The respawn re-reads `config.json` rather than echoing its own argv.** Both
are defensible, and they differ observably when the ceiling was edited since
boot: re-reading makes `/api/restart` the documented way to apply a `serverHeap`
change, which is what this repo's own restart-after-server-change workflow
already assumes. Echoing the live `process.execArgv` would preserve a value the
operator has since changed and quietly require a cold start.

This is a deliberate widening past the three launch paths: without it the
`server-launch` requirement ("SHALL run under the configured ceiling") is
verifiably false the first time anyone restarts, and the spec would ship a claim
the code contradicts. It also retires the sibling's stated "cold start only"
limit for `serverHeap`.

### D4 — The terminal strip reuses the session-spawn strip

`terminal-manager.ts:264` spreads `process.env` wholesale, so a stamped
old-space token reaches every Node tool run in a dashboard terminal.

**The strip keys on the sibling's provenance marker, not on the flag.** Sibling
D4 settled this: "is `--max-old-space-size` present?" cannot work, because the
dashboard puts that same flag into its own environment, so a flag-sniffing test
either never fires or eats the operator's pin. The launcher exports a marker
naming the exact token it wrote; the strip removes **only** that token, and only
when the marker matches what is actually present. No marker, or a mismatch,
means the operator owns it — which is also what makes the
operator-sets-the-identical-value case safe.

**The marker variable is itself dropped from the terminal environment.** Leaving
it behind hands every Node process started in that terminal a marker describing
a token that is no longer there; a descendant that later stamps and strips would
read a stale provenance claim. The terminal gets neither the token nor the
marker.

This lowers terminal headroom from the inherited `8192` to the runtime default
on the standalone-wrapper path — a deliberate, disclosed regression, because the
alternative is silently capping grandchildren at the dashboard's ceiling.

## Risks / Trade-offs

- **The guard's constants are single-host.** → It is a tripwire, not a proof of
  fit; the soak in the sibling change remains the real backstop.
- **The invariant blocks builds when the pairing is wrong.** → That is the
  point; the failure message names both defaults and the fix.
- **Terminal tooling loses headroom.** → Disclosed in the proposal Impact and in
  the docs task. Applies to the standalone-wrapper path only.
- **The response is asymmetric: the guaranteed-OOM *config* gets an advisory
  warning, while a mispaired *default* fails CI.** Stated rather than hidden.
  The asymmetry is deliberate: a default ships to everyone and no operator chose
  it, so it must not escape the repo; an operator-set `maxTotalEventBytes: 0` is
  a chosen value, and this repo's settings surfaces do not block saves — a
  blocking guard here would be the only one of its kind, and would strand an
  operator who is deliberately trading retention for a diagnostic run. The cost:
  an operator can still configure the death case after reading a warning.
- **This guard is cited by the sibling as a mitigation for shipping 1536 at ~84%
  occupancy, yet lands strictly after it.** → During the merge window that
  mitigation does not exist. Not resolvable from inside this change; the
  ordering is stated in Impact so the window is visible rather than assumed away.

## Migration Plan

No data migration. The guard is advisory on save; the invariant is build-time;
the stamp and strip take effect on the next process start.
