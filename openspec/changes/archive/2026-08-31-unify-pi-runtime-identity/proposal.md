# Unify pi runtime identity: follow, don't lead — one ABI per shared native tree

## Why

pi's global extension tree (`~/.pi/agent/npm/node_modules/`) is **arm-independent** — one directory,
one set of compiled native modules, shared by every pi process on the machine. The Node runtime that
loads it is **arm-dependent**. Nothing reconciles the two.

Four arms can run pi against that one tree:

| Arm | Runtime today | Who chose it |
|---|---|---|
| Global pi (`pnpm`/`npm -g`) | `node` on user's `PATH` (nvm/volta/system) | user |
| npm-installed dashboard, spawning pi | user's Node, `PATH` possibly rewritten toward managed Node (`process-manager.ts:240`) | mixed |
| Extension-tree pi invocations | whichever Node invokes them | caller |
| Electron-spawned pi | bundled Node (`<resourcesPath>/node/bin/node`) | app |

Measured on a developer machine running the first and last simultaneously:

| Arm | Node | `NODE_MODULE_VERSION` |
|---|---|---|
| Terminal pi (global install → nvm) | v25.8.1 | 141 |
| Electron-spawned pi (bundled) | v24.15.0 | 137 |

Both ABIs confirmed against the authoritative registry (`nodejs/node
doc/abi_version_registry.json`: 137 = Node 24.0.0, 141 = Node 25.0.0).

```
$ <resourcesPath>/node/bin/node -e 'new (require("~/.pi/agent/npm/node_modules/better-sqlite3"))(":memory:")'
Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 141. This version of Node.js requires 137.
```

A single `npm rebuild` fixes one arm and **breaks the other** — verified in both directions on this
machine. Users running the Electron app *and* a terminal pi ping-pong between a working and a broken
extension tree with no diagnostic naming the cause. Symptom today: `pi-hermes-memory` session
indexing throws; the user-visible artefact is an unexplained "Memory auto-review failed in both
transports" warning.

**The blast radius is one package.** Auditing every `.node` in a populated extension tree:

- `better-sqlite3` — V8-ABI-bound (49 undefined `v8::` symbols), **the only offender**
- `@mariozechner/clipboard-*`, `@napi-rs/keyring-*` — NAPI / per-platform prebuilds, ABI-stable

The class outlives the instance: better-sqlite3 v13 moved to per-platform prebuilt exports but
remains node-gyp/V8-bound by design, and any future extension may add another V8-ABI dependency. The
dashboard must handle the class, not patch the instance.

**The precise invariant.** Not "one Node per machine" — each installation's *private* tree is fine
(the server's `node-pty` is built per-install for its own runtime; Electron's copy is prebuilt in CI
for the bundled Node; the npm arm's is built at `npm install` time for the user's Node). The anomaly
is the one native tree with **no owning runtime**: pi's extension tree. The invariant this change
establishes:

> **Every process that loads `~/.pi/agent/npm/node_modules` SHALL run on the same Node ABI, and the
> dashboard SHALL achieve this by adapting to the user's runtime — never by mutating the user's
> environment.**

### Why the two prior designs died

1. **Symlink pointer** (`~/.pi/dashboard/runtime/node`, terminal opts in via shim): fails the
   shipping matrix — Windows symlink elevation, AppImage `/tmp/.mount_*` re-randomised every launch,
   macOS App Translocation, per-OS dist layout (`bin/` vs flat), and the POSIX bundle ships no `npx`
   (verified), so any `PATH`-shaped pointer delivers a split node/npm/npx family.
2. **Descriptor consumed by a terminal shim**: fixes the link mechanics but keeps the wrong
   *direction* — the terminal follows the dashboard. That direction needs opt-in (silently changing
   the user's pi runtime is worse than the bug), so the common case ships broken by default, and the
   consent UX carries all the complexity.

Both designs tried to **lead**. The terminal user already chose a Node — pi runs on it every day.
The dashboard is the party with machinery to detect, adapt, and rebuild. So the dashboard
**follows**: it spawns pi with the Node the user's terminal pi already uses, and reserves its
bundled Node for machines where no other runtime exists — where, by construction, there is no
second ABI to conflict with.

Second, independent defect surfaced by the same investigation: `~/.pi-dashboard/` is advertised as
deletable while five live consumers write to it.

`shared/src/legacy-managed-dir.ts` (R3, 2026-05-26) declares the directory legacy — *"nothing reads
from or writes to this directory"* — and drives two user-facing advisories that suggest `rm -rf`:

- `server/src/cli.ts:257` → startup log *"No longer used — safe to delete."*
- `shared/src/doctor-core.ts:~1322` → Doctor warning row, suggestion `rm -rf ~/.pi-dashboard`

R3's own doc comment scopes the claim to *"the Electron arm"*, but the advisories are unscoped. Live
writers and readers of that directory today:

| Content | Owner |
|---|---|
| `dashboard-settings.json`, `recommended.json` | `electron/src/lib/wizard-state.ts:76,204` — **Electron wizard, every run** |
| `doctor.log`, `server.log` | `doctor.log` written `shared/src/doctor-core.ts:331`; `server.log` written by the Electron server lifecycle, tailed `doctor-core.ts:1048`; both opened `electron/src/lib/doctor-window.ts:78,89` |
| `node/bin/` managed runtime | read `server/src/spawn-process/process-manager.ts:240`, `server/src/pi/pi-core-updater.ts:123`, `shared/src/tool-registry/strategies.ts:294` |
| `node_modules/` | written `server/src/pi/pi-core-updater.ts:92`; read by 6 modules incl. `shared/src/platform/binary-lookup.ts:316,379` |

Following the app's own Doctor suggestion on the Electron arm **deletes the Electron wizard state and
both log files**. The advisory is not merely stale, it is actively destructive.

## What Changes

Four parts. Part 1 changes the spawn bootstrap (the contract). Part 2 is the guard rail that makes
violations visible and reconciliation converging. Part 3 removes the destructive advice that
misdirects users mid-diagnosis. Part 4 files the upstream escape hatches.

This change **builds on `manage-node-runtime-updates`** (active, 0/52 tasks): it consumes
`classifyNodeSource(nodePath) → "managed" | "system" | "bundled-electron"` from
`specs/node-runtime-update/spec.md` and extends the question from *"which Node does the dashboard's
own tooling use"* to *"which Node loads pi's native extensions"*. It also leans on
`add-node-runtime-family-selection` for node/npm family coherence rather than re-deriving it.

### Part 1 — Spawn-runtime resolution ladder (follow, don't lead)

The dashboard SHALL resolve **one spawn runtime** for pi sessions at every server start, in order:

1. **Explicit override** — `runtime.override` in `~/.pi/dashboard/config.json` (user-owned; the
   dashboard never writes this key), honoured when the named binary exists and passes the version
   gate. An explicit Node-installation selection made via `add-node-runtime-family-selection`'s
   surface is read as a step-1 candidate under the same gate — one user intent, one precedence.
2. **The user's Node** — candidates evaluated in *terminal-fidelity* order, which is
   **arm-dependent**: on GUI/service launches (Electron arm) the **login-shell resolution ranks
   first** (`shared/src/platform/binary-lookup.ts:604` — sources the user's profile, the closest
   *observable* approximation of their terminal; the interactive rc itself is unobservable, and
   the service `PATH` is exactly the thing not to trust first). On terminal-launched arms
   (npm/dev/docker) the **inherited `PATH`'s first hit ranks first** — the server was launched
   from the very shell whose Node the ladder wants, including a session-level `nvm use`
   (login-shell-first would wrongly shadow it with the profile default). Windows: `PATH` first —
   no login-shell concept. Then a
   **filesystem probe of well-known version-manager defaults** (nvm `alias/default`, volta,
   asdf/mise) for setups whose manager initialises only in the interactive rc — pure fs reads, no
   shell. Each source contributes its **first hit only** (the binary the user's shell would
   actually run — deeper `PATH` entries the terminal never executes are not "the user's Node");
   the first gate-passing candidate wins and gate-failing candidates are skipped with a recorded
   reason. The gate: satisfies **pi's declared floor**
   (`engines.node` of the pi copy that will be spawned — pi 0.84.4 ships `>=22.19.0` — read from
   the package.json adjacent to the resolved entry, falling back to the canonical floor constant
   this change adds to `shared/src/node-version.ts` — refactoring the existing inline arithmetic
   into a named export, lockstep-asserted against the predicates so there is still exactly one
   defining occurrence) **and** clears the known-broken-range exclusion (24.1–24.2; see the
   version gate below).
3. **Managed Node** — `<managedDir>/node/` when installed **and gate-passing**: a stale managed
   install below pi's floor or inside the affected range is skipped with a recorded reason (the
   wizard MAY offer to install or refresh it when step 2 finds nothing).
4. **The dashboard's own runtime** — last resort: the bundled Node on the Electron arm,
   `process.execPath` everywhere else (npm/dev/docker — a running server proves that Node exists).
   This makes the ladder total on every arm: it cannot fail to resolve. On non-Electron arms the
   execPath rung is always inside the supported range **by construction**: `node-guard.ts`
   (`assertNodeVersionSupported`) refused to boot the server otherwise, and its floor (`>=22.19.0`)
   is identical to pi's — so a running server's own runtime always satisfies pi. On the Electron
   arm the bundled Node is vendor-pinned and expected in-range; should a future bundle ever fall
   outside pi's range the ladder still terminates here (totality) and Doctor raises a red row.

**Version gate — verified values, one source of truth.** All floors in play are already unified
at `>=22.19.0`: pi 0.84.4 `engines.node`, the dashboard root (`>=22.19.0 <27`), and
`packages/server` (`>=22.19.0`, deliberately cap-free — the `pi-core-version-check` spec pins
"Server `engines.node` matches pi floor"). The gate reuses `shared/src/node-version.ts`'s
`isAffectedNode` plus the canonical floor constant this change hoists there — one defining
occurrence, no scattered literals (the repo-lint `node-cap-message-matches-engines` already
guards the one unavoidable message literal in `node-guard.ts`; `isUsableNodeVersion` is
deliberately not reused wholesale, per the cap divergence below). The step-2 gate is: **passes pi's floor AND is
not in the nodejs/node#58515 affected range** (`isAffectedNode`: 22.0–22.18, 24.1–24.2). The
affected exclusion is hard, for two reasons. First, #58515 is a Node module-loading assertion
(`ERR_INTERNAL_ASSERTION: Unexpected module status 3`) — Fastify's ajv load is the known trigger,
not the bug's boundary, so "spawned pi runs no Fastify" is no safety argument. Second, Electron's
`dependency-detector.ts` (lines 95, 154) already rejects these versions via `isUsableNodeVersion`
when detecting a system Node; step 2 SHALL share that affected-range exclusion — one definition
of "known-broken Node" — while the cap axis deliberately diverges (below): the detector answers
"can the *server* run here", the gate answers "can *pi* run here". Net accept-set: 22.19+, 23.x, 24.0, 24.3+, 25.x, 26.x (and 27+ per the cap
divergence below) — note the hole **inside** 24.x: a 24.1/24.2 user Node passes pi's floor yet
fails the gate, and the ladder falls through to managed/bundled exactly as if no user Node
existed. (`isUsableNodeVersion`'s own doc comment omits 23.x, which its predicates accept — doc
drift filed in Part 3.) One deliberate divergence from `isUsableNodeVersion`: the `<27` cap is the **server's**
tested range, not a spawn constraint — pi declares no cap, so a future user Node 27 still wins
step 2 (refusing it would recreate the ABI split this change removes; Doctor notes it exceeds the
dashboard-tested cap).

This **recomposes existing primitives rather than building a new engine**: `binary-lookup.ts`
already ships the pieces (`PATH` probe, login-shell fallback), but the pi-spawn precedence is new
— step 2 deliberately *skips* the managed/extraBinDirs tiers that `ToolResolver.which` consults
first, because for pi-session spawning the user's runtime outranks the managed and bundled ones.
`prependManagedNodeToPath` (`process-manager.ts:240`) is replaced by the ladder's result.

The ladder resolves a **runtime for a JS entry** — it does not decide where pi comes from. The
tool registry keeps resolving pi's `cli.js` independently, and its bare-import strategy prefers
the dashboard's own pi copy (`<resourcesPath>/server/node_modules/…/dist/cli.js` under Electron;
the server's own dependency on the npm arm) **even when a global pi exists**
(`tool-registry/definitions.ts:511` — bare-import is tried first). The version gate therefore
reads `engines.node` from the pi copy that will actually be spawned; a terminal global pi with a
different floor is that runtime's own concern, surfaced in the Doctor runtime row when readable,
never a gate input. `nodeScriptToArgv` already pairs an arbitrary node with an arbitrary cli.js
(it does exactly this on Windows today). Package choice and runtime choice are orthogonal axes; a
global pi install is **not** a precondition for any ladder step.

**Install/load coherence**: whatever family the ladder resolves SHALL also be the family used for
extension-tree mutations the dashboard itself performs (recommended-extension installs, Part 2
rebuilds), so the tree is always built by the runtime that will load it. This closes an
incoherence R3 left open: post-R3, `pi install` resolves against the user's npm-global when one
exists (archived R3 proposal, correction 2026-05-20), so on a machine with a user Node the tree is
*built* with the user's toolchain while Electron *loads* it with the bundled Node — mismatch by
construction, no global pi required.

Consequences, per arm:

- **Global pi + Electron** (the reported dilemma): step 2 fires → Electron spawns pi with the
  user's Node → both arms share one ABI → the shared tree is coherent. **No consent problem
  exists**: the dashboard is using the Node the user already chose for pi.
- **Electron alone, no user Node** (as the probes see it — an undiscoverable or gate-failing
  terminal Node is the residual-heterogeneity case under Impact): step 3 or 4 fires (managed Node
  when installed, else the bundled Node) — exactly today's precedence, and the chosen runtime is
  the *only* dashboard-aimed runtime loading the tree → single ABI by construction. The conflict requires two runtimes; when the
  managed/bundled Node is legitimately in use, there is no second. Extension installs on this
  machine use the matching npm (`electron/src/lib/bundled-node.ts` resolves the bundled
  `npm-cli.js` — the POSIX bundle's npm lives under `lib/node_modules/npm/`, not beside the
  binary), so build and load agree. Zero change for the pure desktop user.
- **Electron + user Node ≥ 22.19.0, no global pi**: step 2 still fires — bundled `cli.js`, user's
  Node. Deliberate, for two reasons. (1) Install/load coherence, above: on this machine extension
  installs already target the user's environment per R3, so loading with the bundled Node is the
  incoherent choice. (2) Seamless dual-arm transition: when this user later installs a global pi —
  the natural next step for someone with Node — the tree is already on their ABI; today that exact
  moment is when the breakage starts. A user Node below 22.19.0 is rejected by the gate (npm
  would refuse a global pi install on it with EBADENGINE), and the ladder falls through to
  managed/bundled.
- **npm-installed dashboard**: the server itself runs on the user's Node; step 2 resolves the
  same runtime — converged (when the server was launched via that same environment; the
  off-`PATH` absolute-path launch lands on `execPath` per the matrix). One real behavioural delta on this arm: a machine that *also* has a
  managed Node installed today gets the managed prepend (`process-manager.ts:240`); under the
  ladder the user's Node outranks it, so spawns switch managed→user with one offered convergent
  rebuild. Docker: single containerised Node, trivially converged.
- **User installs Node later** (Electron-alone → dual-arm transition): the next server start
  re-runs the ladder, the chosen ABI changes, Part 2 detects the now-mismatched tree and offers the
  **one converging rebuild**. This is not ping-pong: ping-pong required two arms in *permanent*
  disagreement; after the switch every arm agrees.

#### Completeness matrix

The ladder is a pure function of four inputs — override, user Node state, managed Node presence,
arm — so coverage is provable by enumeration rather than by anecdote. A valid override wins
everywhere (all arms share `~/.pi/dashboard/config.json`); the remaining cells:

| Arm ↓ / machine state → | user Node passes gate¹ | user Node fails gate¹ | no user Node, managed present | neither |
|---|---|---|---|---|
| Electron | user Node (step 2) | managed if present, else bundled | managed (step 3) | bundled (step 4) |
| npm `-g` dashboard | user Node (step 2 — the server already runs on it) | managed if present, else execPath | managed (step 3) | execPath (step 4) |
| dev checkout (jiti) | same as npm arm | same | same | execPath (step 4) |
| docker all-in-one | image Node (step 2; `node:24-bookworm-slim`, pi preinstalled in-image) | — (image ships one Node; other columns unreachable) | — | — |

¹ Gate = pi floor + `isAffectedNode` exclusion (accept-set 22.19+, 23.x, 24.0, 24.3+, 25.x, 26.x,
and 27+ per the cap divergence; see
“Version gate” above). “Fails gate” covers both below-floor Nodes and the 24.1–24.2 hole — a
24.1 user Node behaves exactly like an absent one. On the npm/dev arms the failing column is
near-unreachable for the *server's own* Node (`node-guard.ts` refused to boot there), but a
different, gate-failing Node earlier on `PATH` than the server's can still occur — the ladder
probes `PATH`, not `process.execPath`.

Every cell yields exactly **one** runtime per machine state, and every process the dashboard aims
at the shared tree uses it. Cross-cutting cases that fall out of the same inputs:

- **User Node and managed Node both present**: user wins (step 2 > 3) — deliberate. Terminal pi
  runs on the user's Node; preferring managed would *reintroduce* the divergence. The managed
  install (`~/.pi-dashboard/node_modules` pi core) remains usable — package axis, runs on the
  resolved runtime.
- **Two dashboards concurrently** (e.g. Electron app + npm `-g`): steps 1–3 depend only on shared
  machine state, so whenever any of them resolves, both dashboards agree. The step-4 fallback is
  arm-local (bundled vs `execPath`) and CAN diverge in the narrow state where steps 1–3 all miss
  on a machine running two dashboards at once; Part 2's guard names the resulting mismatch, and
  either an override or a managed-Node install restores agreement. Concurrent `runtime.resolved`
  publishes may then alternate — benign, because nothing consumes the block for execution.
- **pi version skew across copies** (global 0.84 vs bundled vs managed): explicitly orthogonal.
  ABI of the shared native tree is the only axis this change owns; which pi *version* runs is the
  tool registry's existing business, unchanged.
- **Extension-tree pi copy executed directly** (`~/.pi/agent/npm/node_modules/.../cli.js`): a
  dependency artifact, not an install; whoever execs it chose a Node. User-chosen plurality —
  Part 2 names the mismatch; governance is out of scope.
- **Server launched with an off-`PATH` Node** (systemd unit, absolute path): steps 2–3 miss,
  step 4 execPath resolves the launching Node itself — the only Node demonstrably in play.

Scope guard: the ladder governs **pi-session spawns only** (processes that load the shared
extension tree). The Electron app SHALL continue to run the dashboard *server* on its bundled Node —
the server's private `node_modules` (incl. `node-pty`) is prebuilt in CI for that runtime, and
moving it to the user's Node would reintroduce the exact ABI failure this change removes, one
directory over.

Persistence rules (this is where the prior designs broke):

- The resolved runtime SHALL be published as `runtime.resolved` in `~/.pi/dashboard/config.json`
  (`nodeBinDir`, `nodeBinary`, `abi`, `source` via `classifyNodeSource`, `resolvedAt`) —
  machine-owned, rewritten every start, extending the designed-but-unimplemented `toolPaths`
  architecture in `docs/service-bootstrap.md` including its re-validate-on-every-start loop. It is
  **disjoint from the user-owned `runtime.override` key, which the dashboard never writes** —
  publication can neither destroy a user's pin nor accidentally become one.
- Bundle-internal paths SHALL NOT be persisted, ever — stable installs included (an app update
  replaces the bundle silently), not just the ephemeral mounts: AppImage `/tmp/.mount_*` (already
  rejected by `shared/src/bridge-register.ts:23`) and the previously-unguarded macOS
  `/AppTranslocation/` re-randomise per launch. When the resolved runtime is the bundled Node,
  `runtime.resolved` records source + ABI only; the path is re-derived live from
  `process.resourcesPath`.
- The block is diagnostic + inspectable state (Doctor, `pi-dashboard runtime` CLI print). **Nothing
  consumes it for execution — resolution always runs live.** No symlink, no junction, no generated
  shim, no `PATH` mutation of the user's shell — the entire per-OS link problem from the prior
  designs is deleted, not solved.

### Part 2 — ABI guard rail (now converging)

- A helper `readNativeModuleAbi(dotNodePath) → number | null` SHALL extract the recorded
  `NODE_MODULE_VERSION` from a compiled `.node` file without loading it into the dashboard
  process — file inspection where feasible, out-of-process probe as fallback; a probe failure
  cannot take down the server.
- A scanner SHALL walk pi's global extension tree, skip modules whose compiled binaries are
  N-API (ABI-stable) — identified by **binary/module inspection, never by distribution format**:
  better-sqlite3 ships per-platform prebuilds yet remains V8-ABI-bound — and compare each V8-ABI
  module against the **resolved spawn runtime's** ABI.
- On mismatch, Doctor SHALL surface one row per module: module, built ABI, resolved runtime + ABI,
  and the exact scoped reconciliation command (`npm rebuild <module>` with the resolved Node's
  family, per `add-node-runtime-family-selection`).
- Reconciliation SHALL be **offered, not silent**: a one-click Doctor action / CLI confirm, plus a
  `runtime.autoRebuild: true` config flag for headless setups. Under Part 1 a rebuild *converges*
  (all arms use the resolved runtime), so automation is safe in principle — the consent gate exists
  because a rebuild downloads prebuilds or invokes compilers, which should not happen invisibly.
  This supersedes the earlier "never auto-rebuild" stance, whose premise (rebuild = last-launcher-
  wins) Part 1 removes. One carve-out keeps the flag honest: when the Doctor visibility check
  detects resolved-vs-terminal divergence (e.g. an rc-only version-manager setup the probes cannot
  fully see), `autoRebuild` SHALL abstain and fall back to the offered flow — an unattended rebuild
  against a wrongly-resolved ABI would be the old ping-pong with extra steps.
- The pre-spawn path SHALL stay cheap without going blind: a bounded discovery walk (depth-capped,
  dependency dirs included — the real offenders live nested, e.g. `better-sqlite3/build/Release/`
  and `prebuilds/**`) builds a **manifest** of compiled-module files; the pre-spawn check merely
  re-stats the manifest entries against the resolved ABI, which catches an in-place `npm rebuild`
  (file mtime changes, tree shape doesn't — the exact incident action). The full re-walk runs at
  server start, on manifest drift, and on Doctor demand.

### Part 3 — Home-directory contract

- `detectLegacyManagedDir()` SHALL report `present: true` only for a **genuinely orphaned** tree:
  no `node/` managed runtime, no Electron wizard state files, no non-empty `node_modules/`, and no
  `doctor.log`/`server.log` (logs are live content — the Doctor itself appends and tails them).
- The Doctor suggestion and `cli.ts` startup log SHALL stop recommending `rm -rf` on any directory
  that fails that test; when live content is present the row SHALL name which consumers still own it.
- `server/src/auth/node-guard.ts:35` SHALL qualify its `PATH="$HOME/.pi-dashboard/node/bin:$PATH"`
  remedy as applicable only when a managed Node is actually installed, or drop the line. Its
  assertion in `server/src/__tests__/node-guard.test.ts:179` moves with it.
- Documentation SHALL state the ownership split: `~/.pi/dashboard/` = user config + published
  runtime state; `~/.pi-dashboard/` = machine-managed runtime, managed `node_modules`, and logs.
- Version-text drift found while verifying the gate SHALL be fixed in the same docs pass:
  `README.md:120,126` claims Node 22.18 passes the guard (false since `bump-pi-compat-to-0-75`
  moved the floor to 22.19 — 22.18 is refused), and `docs/architecture.md` ("Node-version
  preflight") still shows the retired `>=22.18.0 <23 || >=24.3.0` range. Both align to the
  `node-version.ts` range; only `node-guard.ts`'s literal is repo-lint-guarded today. Same pass:
  `.pi/skills/debug-dashboard/references/known-issues.md:26-29` still lists affected =
  22.0–22.17.x and fix ≥ 22.18.0 — both pre-widening values (now 22.0–22.18 / ≥ 22.19).
  `shared/src/node-version.ts`'s own accept-set doc comment omits 23.x, which its predicates
  accept. And `docs/architecture.md:2932` names `platform/node-version-check.ts` exporting
  `isKnownBadNode` — neither the path nor the symbol exists (reality:
  `shared/src/node-version.ts`, `isAffectedNode`).

### Part 4 — Upstream escape hatches (report, don't own)

- **File upstream to `pi-hermes-memory`**: prefer builtin `node:sqlite` (`DatabaseSync`) when
  available, falling back to `better-sqlite3`. Verified timeline: added v22.5.0, unflagged since
  v23.4/v22.13, **release candidate since v25.7** (Stability 1.2). Both runtimes measured on this
  machine (bundled v24.15, terminal v25.8) already ship it. Landing that removes the last V8-ABI
  module from the tree and collapses this failure class for hermes users entirely.
- **File upstream to pi**: note that the global extension dir is a shared native tree with no
  owning runtime; per-ABI segregation of `.node` artifacts (à la `node-gyp-build`'s
  `prebuilds/<platform>-<arch>/`) would fix the class for all consumers. Long-term; not blocking.
- These are tracked tasks producing issue links, not implementation work in this repo. Part 2's
  guard stays regardless — the dashboard cannot assume every future extension dependency is
  ABI-safe.

## Platform analysis

| Concern | macOS | Linux `.deb` | Linux AppImage | Windows NSIS/ZIP |
|---|---|---|---|---|
| Step-2 user-Node resolution | `PATH` + login-shell fallback (exists, `shared/src/platform/binary-lookup.ts:604`) | same | same | global `PATH` (registry; no login-shell needed, `service-bootstrap.md:290`) |
| Spawn mechanics | `node` binary | same | same | absolute `node.exe` + `cli.js` — already mandated (`docs/installation-windows.md`; headless spawn rejects `.cmd`) |
| Bundle path stability | translocation risk → never persisted | stable | `/tmp/.mount_*` ephemeral → never persisted | stable |
| Links/shims/junctions needed | **none** | **none** | **none** | **none** |

The follow-don't-lead design needs no filesystem indirection on any platform — the mechanisms that
made the prior designs platform-hostile are absent, not mitigated. The bundled POSIX runtime's
missing `npx` (verified; spec `bundled-node-runtime` requires `npx.cmd` on Windows only) stops
mattering for spawning: when step 2 fires, the family is the user's own complete installation;
family coherence for dashboard tooling remains `add-node-runtime-family-selection`'s scope.

## Capabilities

### Modified Capabilities

- `managed-node-runtime` — managed Node demoted from automatic `PATH` prepend to ladder step 3;
  adds the resolution-ladder, resolved-runtime publication (incl. the AppImage/AppTranslocation
  never-persist guard), pi-session spawn-env, managed-tree retention, and install/load-coherence
  Requirements; removes "Spawned children inherit managed Node on PATH" (the pi-session spawn-env
  contract — including what replaces `prependManagedNodeToPath` — lives here; `tool-registry`'s
  strategy chains for dashboard tooling are deliberately untouched).
- `doctor-diagnostic` — adds the ABI-mismatch Requirement (rows + offered reconciliation) and the
  resolved-runtime visibility Requirement; re-scopes the legacy-directory advisory Requirement to
  genuinely orphaned trees (live content names its consumers, never `rm -rf`), covering the
  startup-log advisory with the same orphan test.
- `server-startup-node-version-guard` — the managed-Node `PATH` hint in the engines-range message
  becomes conditional on a managed runtime actually existing under `<managedDir>/node/`.

### Ambient dependency

- `node-runtime-update` (from `manage-node-runtime-updates`) — consumes `classifyNodeSource`. If
  that change has not landed when this one is implemented, this change SHALL vendor the classifier
  under the same name and signature so the two converge on one implementation rather than forking.
- `add-node-runtime-family-selection` — supplies the npm-of-the-resolved-Node used by the offered
  rebuild.

## Discipline Skills

- `doubt-driven-review` — the ladder changes which binary executes pi for every dashboard user;
  ordering, minimum-version gate, and the Electron-server carve-out get stress-tested before they
  stand.
- `systematic-debugging` — the ABI class is reproduced in both directions on a live machine; any
  regression during implementation gets root-caused against that reproduction, not patched by
  another rebuild.
- `observability-instrumentation` — Part 2 exists purely to make an invisible runtime failure
  visible; Doctor row wording, trigger conditions, and false-positive rate are the acceptance
  surface.
- `security-hardening` — step 2 executes a binary resolved from the user's login shell/`PATH` in
  a server context: resolution hygiene needs review — absolute paths, no shell interpolation, and
  validation before *adoption* (the fixed-argv version probe is itself the validation exec: same
  trust boundary as the user's own terminal running `node`) — as does the `autoRebuild` flag
  (running package scripts implicitly).
- `review-code` — before commit, per project default for a non-trivial change.

`code-simplification` and `performance-optimization` are not triggered: the change replaces
machinery rather than cleaning it, and the only hot-path addition (pre-spawn cache check) is bounded
and cached.

## Impact

- **Single-arm users see zero difference.** Terminal-only: dashboard not involved. Electron-only:
  ladder falls through to bundled Node exactly as today. npm-arm: server and spawns already share
  the user's Node.
- **Dual-arm users get structural convergence wherever the user's Node is discoverable** (`PATH`,
  login shell, or version-manager default) — eliminated by construction there, not detected after
  the fact. The undiscoverable residue (exotic rc-only setups the probes cannot see) degrades to
  Doctor-guided convergence: visibility row + override, and no silent divergent rebuilds
  (`autoRebuild` abstains). Residual heterogeneity the user chooses (pi under two different Nodes
  themselves, e.g. nvm per-shell, or a terminal kept on a gate-failing 24.1/24.2 Node the
  dashboard refuses to follow) is named by Doctor; the dashboard no longer *adds* a divergent
  runtime of its own.
- **Behavioural change on the Electron arm**: machines with a user Node ≥ 22.19.0 switch pi
  spawns from bundled to user Node at next start. One offered rebuild reconciles the tree once; after
  that, both arms stay green through app updates (bundled ABI bumps stop mattering when bundled is
  not in use).
- **The `rm -rf` footgun is removed**, including on the Electron arm where it currently destroys
  the app's own wizard state.
- **Risk — user's Node disappears** (nvm uninstall): ladder re-resolves at next start (managed →
  bundled fallback); running sessions are unaffected (already exec'd). Doctor explains the switch
  and re-offers reconciliation. The shipped `-x`-guard lesson from the failed hand-written shim is
  preserved: no resolution result is trusted without an existence + version check at spawn time.
- **Risk — first-start latency**: login-shell resolution adds one shell invocation on the startup
  path; already accepted for tool detection, and cached with the same lifecycle.
- **Risk — login-shell vs terminal divergence**: the probe sources `~/.zprofile` (`-lc`,
  non-interactive — `shared/src/platform/binary-lookup.ts` invariant), and the interactive rc is
  unobservable from a service context. The step-2 version-manager-default probe removes the common
  nvm-in-`.zshrc`-only case from this class; for the remainder, Doctor SHALL show the resolved
  runtime beside every probe-discovered installation with a `node -v` compare remedy, and the
  config override is the deterministic escape hatch.
- **Out of scope**: changing which Node the Electron app bundles; managed-runtime upgrades (owned
  by `manage-node-runtime-updates`); node/npm family selection (owned by
  `add-node-runtime-family-selection`); implementing the hermes/pi upstream fixes (Part 4 files
  them).
