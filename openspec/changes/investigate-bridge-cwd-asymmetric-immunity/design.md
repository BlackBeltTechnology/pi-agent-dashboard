# Design — investigate-bridge-cwd-asymmetric-immunity

## Context

See `proposal.md` — Why. Investigation into a pre-fix asymmetry; the migration
guard (`fix-bridge-mdns-migration-hijack`, archived 2026-08-29) already removes
the user-facing defect. The matrix ran ~2026-08-28/29 on the pre-fix build.

Mechanism inventory relevant to a cwd-dependent difference (verified against
the current tree; each is a hypothesis input, not a conclusion):

- **Extension load sources.** Global `~/.pi/agent/settings.json` loads the
  bridge from the local working tree path
  (`…/pi-agent-dashboard/packages/extension`, entry `src/bridge.ts`) for
  **every** cwd on this machine. The dashboard repo *additionally* declares
  `pi.extensions: ["packages/extension/src/bridge.ts"]` in its root
  `package.json` (activated by `.pi/settings.json` `"source": ".."`). Both
  resolve to the same source file — but only the dashboard-repo arm can load
  the extension **twice**, i.e. two bridge instances, two connections, one
  session id. `fix-duplicate-bridge-registration` (archived 2026-08-13,
  pre-matrix) proves dual registration *can* happen in exactly this cwd —
  but neither confirms nor kills immunity: that incident's outcome was a
  defect (the second bridge won the slot and starved the transcript), not
  survival — and that defect is exactly what the 08-13 change fixed
  (contention resolved by demonstrated liveness). The matrix ran under the
  post-08-13 semantics, so how a dual load behaves at matrix time must be
  re-derived under those semantics, not assumed from the incident.
- **Spawn env pin.** `buildSpawnEnv` (`packages/server/src/spawn-process/
  process-manager.ts`) sets `PI_DASHBOARD_URL=ws://localhost:<port>` and, when
  a socket is served, `PI_DASHBOARD_SOCKET` — landed with
  `add-pi-gateway-transport-identity` (archived 2026-08-24, released v0.8.0 on
  2026-08-26, i.e. *before* the matrix). Under that change's D3 ladder these
  are PINNED, and its D4 stickiness gate (`decideRetarget`) refuses
  re-targets of pinned endpoints. The
  env *values* are cwd-independent — if the pin had been in force in all
  arms, none should have migrated; six did. Two per-arm variables, however,
  are NOT cwd-independent: **spawn route** (only dashboard-spawned processes
  pass through `buildSpawnEnv`; a terminal-started session gets no pin) and
  **code vintage** (the extension loads from the working tree at session
  start, so arms spawned hours apart during active development can run
  different resolution code). The sharp question is which resolution code
  and which env each arm actually ran, per its spawn route and start time.
- **Timing.** The immune arm reproduced twice, 2 h apart (parent matrix) —
  weakens, does not kill, a pure race explanation.

Constraints:

- The `bridge_diagnostic` channel itself PRE-DATES the matrix: it landed
  with the gateway change (`67adeaf57`, 2026-08-24), and the server writes
  every event to its own stdout as `[bridge-transport] session=<id>
  <event>: <detail>` (`event-wiring.ts`) precisely because bridge stdout is
  discarded under default `capturePiOutput:false`. Only the fix's
  *re-target refusal* events are missing pre-fix. Matrix-time `server.log`
  therefore likely holds per-arm endpoint-resolution lines — a primary
  forensic source. Emission is vintage-conditional: the lines exist only
  for arms whose extension vintage is ≥ 08-24, so an arm with no rows is
  itself vintage evidence, not merely missing data. Beyond that channel, passive extension-side logging is
  stdout only (`keeperLog.capturePiOutput=true` to keep it). The
  `/dashboard where` command (also 08-24) reports endpoint + identity +
  pinned state — an interactive per-arm probe during replay, useless for
  forensics on the original incident.
- The parent's E2E replay (its task 6.1) was attempted 3× and deferred after
  the harness **leaked test arms onto the live dashboard** (env-inheritance
  bug). Any replay here must run under the isolated-verification procedure —
  never against the live instance.
- Forensic sources likely still exist: `~/.pi/dashboard/server.log` (live,
  ~16 MB, may still span the matrix window), possible `keeper-<id>.log`
  captures from the parent investigation, config backups, git history for
  both settings surfaces.

## Goals / Non-Goals

**Goals:**

- Name the mechanism that kept the dashboard-repo arm's bridge, with evidence
  that *predicts* per-arm outcome across the original matrix.
- Confirm by flip: removing the factor makes the immune arm migrate; adding
  it makes a migrating arm immune (on the pre-fix build, in isolation).
- Surface any still-live defect (e.g. pin bypass, double extension load) as
  its own filed change; this change stays behaviour-neutral.

**Non-Goals:**

- No code or behaviour change lands from this change.
- Not re-verifying the migration guard itself (parent unit tests own that).
- Not fixing whatever is found — file follow-ups instead.

## Decisions

**D1 — Forensics before replay.** Mine surviving artifacts (server.log matrix
window, keeper logs, config/git history) before staging anything. Alternative:
go straight to the seven-arm replay — rejected: the replay is the expensive
and risky step (it leaked arms onto the live dashboard last time), and the
original incident's own logs may already discriminate the hypotheses.

**D2 — Replay runs the identified matrix-time commit, not an approximation.**
Identify the commit the live server and extension actually ran during the
matrix (server.log startup lines, git reflog around 2026-08-28) and pin a
worktree there. Alternative: current build with the guard "disabled" —
rejected: no such toggle exists, and fidelity to the pre-fix resolution path
is the whole point. Caveats forensics must bound: reflog shows checkouts,
not what a long-running process executed — the server may have run
uncommitted working-tree state, and the extension loads from the working
tree at each session start, so arms may differ in code vintage across the
matrix window. Record per-arm session start times plus every commit/reflog
move inside the window; if the exact state is unattainable, pin the nearest
commit and record the caveat (D7 governs the not-reproducible exit). If
the drift list leaves code vintage alive as a discriminator, a
single-vintage replay structurally cannot test it (all arms share one
vintage — a temporal cause collapses into all-migrate/all-keep): the
replay then carries a vintage dimension — pin two worktrees (window-start
and window-end commits from the 1.3 drift list) and run the discriminating
arms at both, so the D6 prediction spans arm × vintage. Mechanics: vintage
phases run sequentially in the same isolated environment, re-pointing the
seeded load surface between phases (phase order recorded). If the drift
list is empty or uniform, the endpoint dimension is vacuous — record that.
When H-resolution-path is alive, also pin the decisive pre/post-gateway
boundary (last pre-08-24 commit) as an explicitly-labeled boundary probe
even if it lies outside the window — it tests the mechanism, not matrix
fidelity.

**D3 — Instrumentation channels: the `[bridge-transport]` server-stdout
lines (already emitted at matrix vintage — see Constraints), plus
`keeperLog.capturePiOutput=true` for bridge stdout, plus temporary stdout
probes in the pre-fix worktree only where those two fall short.**
`/dashboard where` complements them as an interactive per-arm probe.
Probes are temporary and removed at close-out (parent task 6.6 pattern).

**D4 — Isolation is mandatory for every replay arm.** Temp **HOME** (the
home-lock permits one dashboard per `<homedir>/.pi/` — a second config dir
under the live HOME is insufficient), non-8000 ports, poisoned advertiser
staged per the isolated-verification procedure. Two hard requirements that
procedure does not cover:

- **Multicast containment, not disablement.** `PI_DASHBOARD_NO_MDNS=1` is
  unusable — mDNS discovery is the mechanism under test. The docker
  harness's own test profile sets exactly that variable
  (`docker/compose.test.yml` `PI_DASHBOARD_NO_MDNS: "1"`), so using the
  harness requires a **local, uncommitted compose override** re-enabling
  mDNS inside the container network; container networks do not forward
  link-local multicast to the host/LAN, which is the containment. Verify
  containment in BOTH directions: the advertisement invisible from the
  host (60 s pre-flight browse before arms start), AND deliverable to the
  arms — a known-migrating canary (the wedge-repro cwd) must migrate
  within 60 s before any other arm's outcome is trusted; an all-kept
  matrix without a migrating canary is a staging defect, not a result. Alternative: a second machine on an isolated network segment
  (the parent 6.1 conclusion). A bare same-host replay is **excluded**:
  mDNS is link-local multicast — a poisoned advertiser reaches every
  browsing bridge on the LAN, and pre-verifying the live server's sessions
  protects only that one victim.
- **Load-surface parity.** The six non-repo arms load the bridge only via
  the HOME-derived global settings; a bare temp HOME has no such file, so
  those arms would load no bridge at all — never register, never migrate —
  a structural false immunity for the repo arm. Seed the temp HOME with a
  settings surface replicating the matrix-time global load (bridge from
  the pinned worktree), and score no arm's outcome until it has registered.
- **Code parity for the repo arm + flip authority.** The dashboard-repo
  arm's replay cwd is the pinned pre-fix worktree itself (it carries the
  same repo-local load surfaces) — never the live repo, whose repo-local
  surface would load current post-fix code and manufacture immunity. Flip
  experiments may mutate the staged env and the pinned worktree
  (uncommitted, torn down at close-out); the live repo is never edited.

An arm appearing on the live dashboard aborts the run. Grounded in the
parent 6.1 triple failure.

**D5 — Hypothesis order: cheapest evidence first** (`systematic-debugging`):

1. **H-dual-load** — dashboard repo loads the bridge twice → two
   registrations; a surviving connection keeps the arm reachable. Static
   half needs no replay: count `session registered` lines per arm in the
   matrix window, pairing each with its token/pid — a raw line count cannot
   distinguish dual-load from a legitimate re-register after `/reload` or
   reconnect (the 08-13 analysis disambiguated exactly this way). The
   dynamic half must *derive* why redundancy survives the hijack under
   post-08-13 contention semantics, not assume it.
2. **H-resolution-path** — extension code vintage (working-tree load at
   session start) put exactly one arm on the pinned/post-gateway resolution
   path. The spawn-route half is presumed dead: the parent states "Seven
   spawns against the live server, varying only cwd" — route was constant
   across arms; task 1.5 verifies that premise from the log (all seven
   dashboard-spawned, incl. whether `SessionOptions.extensions` carried
   explicit per-spawn extension args) rather than treating route as a live
   discriminator. Evidence: per-arm start time from server.log vs the
   reflog moves inside the window. Flip: run the same arm at the other
   vintage (see D2 vintage dimension).
3. **H-config** — a cwd-local config surface altering discovery for that
   repo only, *other than* the two load surfaces H-dual-load already owns
   (root `pi.extensions` + `.pi/settings.json`) — e.g. a plugins dir or a
   discovery-affecting setting. Without a named third surface this folds
   into H-dual-load rather than counting as an independent candidate.
4. **H-timing** — spawn racing the stale advertisement; tested last, only if
   1–3 die, with repeated runs.

**D6 — Confirmation = prediction + flip, not correlation.** A hypothesis is
confirmed only when it predicts all seven original outcomes *and* the flip
experiment moves immunity with the factor (both directions where feasible).
A composite factor set counts as one hypothesis here: if only an
interaction (e.g. dual-load × timing) predicts all seven, report the
interaction explicitly — do not force a single factor or fall through to a
D7 negative.

**D7 — Bounded effort, negative result allowed.** If the pre-fix replay
cannot reproduce the original migration at all (environment drift, missing
artifacts), record what each hypothesis's forensic evidence established,
close the question as not-reproducible, and rely on the behavioural guard as
the durable defense. The parent fix already removed the user-facing risk.
Middle case — migration reproduces but the immune arm also migrates
(asymmetry gone): a temporal/vintage-class verdict is permitted only when
the D2 vintage dimension actually ran (both endpoints, plus the boundary
probe where mandated); at a single vintage this is exactly the collapse D2
predicts and supports no temporal conclusion — record "asymmetry not
reproducible at fixed vintage" with the uncommitted-state drift caveat,
and close via D7 without overclaiming a mechanism.

## Risks / Trade-offs

- [Replay leaks arms onto the live dashboard again] → D4 isolation + explicit
  leak check as the first assertion of every replay task; abort on sight.
- [Pre-fix worktree no longer builds (dependency drift)] → worktree checkout
  keeps the matrix-time lockfile; if install still fails, fall back to
  forensics-only closure per D7.
- [Original logs already rotated/truncated] → forensics tasks record absence
  explicitly; hypothesis ranking then leans on git/config history, and the
  replay becomes the primary evidence.
- [Dual-load exists in *other* arms too (global source loads everywhere)] →
  H-dual-load must verify the per-arm load count from evidence, not assume
  the repo-local source is the only doubling mechanism.
- [Timing hypothesis is non-deterministic] → repeated runs per arm with
  recorded probabilities; a single quiet run neither confirms nor kills it.
- [Single-vintage replay masks a temporal cause] → D2 vintage dimension
  (two pinned worktrees) whenever forensics leaves vintage alive.
- [Harness compose override drifts its isolation guarantees] → the
  override stays local/uncommitted; containment re-verified (advertisement
  invisible from the host) before any arm runs.

## Migration Plan

None — investigation only. Close-out removes probes, worktrees, and staged
dashboards; `git status` ends clean; findings land in `findings.md` inside
this change directory.
