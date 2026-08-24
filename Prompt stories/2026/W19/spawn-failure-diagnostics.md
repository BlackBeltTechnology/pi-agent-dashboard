---
session: 019df054
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (58 user prompts); large facts sheet (~29265 tok)"
upgrade_status: pending
openspec_changes: [fix-windows-electron-zip-install, spawn-failure-diagnostics]
proposal_excerpt: "A series of test runs of the Windows Electron ZIP build (PI-Dashboard-win32-x64) revealed five distinct first-run blockers that prevented installation on a clean Windows machine, including one with a non-ASCII / space…"
---

# How we did it: land spawn-failure-diagnostics, then remote-debug the Windows ZIP first-run wizard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was tiny: **"proposal: spawn-failure-diagnostics. is there anything to clarify?"**
The real objective that emerged over 58 prompts was two-headed:

1. **Ship the `spawn-failure-diagnostics` OpenSpec change** — classify and persist
   pi-spawn failures (preflight resolver, register watchdog, failure log, REST
   endpoint, error banner, settings knob) with full test coverage.
2. **Then actually deploy it** — which exposed that the Windows Electron ZIP build
   couldn't even *install* on a clean machine. That pivot became the bulk of the
   session: a **remote, iterative debugging loop** across a build-machine / test-machine
   boundary, driven entirely by the human pasting raw errors and Doctor reports from a
   Windows box with a non-ASCII username (`Róbert Csákány`). Five distinct first-run
   blockers surfaced one at a time, ending at a bundled-npm `Class extends value
   undefined` crash rooted in a stale nested `minipass` v3.

Two commits landed (`090a035` feat spawn-diagnostics, `0d7631d` fix electron-windows)
plus follow-up build-script hardening — and a second OpenSpec change,
`fix-windows-electron-zip-install`, was authored mid-session to scope the packaging fixes.

## 2. TL;DR playbook

1. **Clarify the proposal before applying.** Ask the AI to read all change artifacts and
   surface *internal contradictions* — it found `10 s` vs `30 s` watchdog mismatch and a
   stale D6 protocol snippet. Answer with terse numbered replies (`1. config / 2. ok / …`).
2. **Apply the change** via the `openspec apply` flow; let the AI write source + tests
   together, verify with `tsc --noEmit` then a scoped `vitest run` per new test file
   (use `HOME=$(mktemp -d)` to dodge the home-lock).
3. **Force build parity, don't accept a local shortcut.** When the AI writes a local
   `build-windows-zip.sh`, keep asking **"same as CI?"** until it matches: full
   `bundle-server.mjs` (no `--source-only`), `resources/node/` download, offline cache.
4. **Debug the packaged app remotely as a loop:** human pastes the exact error / Doctor
   output → AI diagnoses + ships a code fix → human rebuilds ZIP + retests → repeat.
5. **When a native crash is opaque, force a stack trace.** `set
   NODE_OPTIONS=--stack-trace-limit=200` + redirect stderr to a file pinpointed
   `minizlib/dist/commonjs/index.js:178` → the real culprit (nested `minipass`).
6. **Make the build script idempotent/self-healing** — it was silently reusing a stale
   `resources/node/`. Add a canary check that wipes+re-extracts when the culprit file is
   wrong; pair `resources/node/` freshness with offline-cache regeneration.
7. **Commit in logical units** — separate the feature change from the packaging fixes;
   author a second OpenSpec change for the packaging scope.

## 3. How the collaboration unfolded

**Phase A — Proposal audit (Discovery).** The AI read all four change artifacts and
returned a *contradiction list* rather than blindly applying: design.md Goals said 10 s
but the config field was 30 s (5–120 s clamp); the D6 protocol snippet still typed `pid`
as required and omitted `spawn_register_recovered`. It also flagged an auth-posture
decision on `/api/spawn-failures` and verified the `ToolResolver` constructor signature
in `binary-lookup.ts:140` before trusting task 6.1. **Why it worked:** auditing the spec
for self-consistency *before* writing code caught defects while they were still cheap.

**Phase B — Implement + verify (Generate).** Applied the change: created
`spawn-preflight.ts`, `spawn-register-watchdog.ts`, `spawn-failure-log.ts`, the
`SpawnErrorBanner.tsx`, plus 6 test files (97 tests). Verified with `tsc --noEmit` per
package and scoped `vitest run` on each new test. 66/66 tasks; verification report all-green.

**Phase C — Deploy pivot → build-script parity (Design).** "build and deploy" turned into
a hunt for how to build a Windows-only ZIP locally. The human pushed hard on parity via a
chain of short prompts ("what is used by ci?", "local build windows build same as CI?",
"the windows builder use that way"). Each forced the AI to close a gap: missing
`resources/node/` download, `--source-only` skipping native modules, opt-in vs always-on
offline cache, arm64-vs-x64 node-pty prebuilds. End state: script mirrors `docker-make.sh`.

**Phase D — Remote first-run debugging loop (Verify, the long tail).** The human ran the
ZIP on a clean Windows VM and pasted each failure verbatim. The AI diagnosed remotely and
shipped a fix per blocker:

- *"No Node.js available"* → `build-windows-zip.sh` never downloaded `resources/node/`.
- *`cross-spawn` cache mode `only-if-cached`* → offline cache built with host npm 11 but
  run by bundled npm 10 (cache-key format mismatch) → `--offline`→`--prefer-offline`, then
  a **registry fallback** wrapping the offline path, then build the cache with the *bundled*
  npm.
- *`git clone … Too many arguments`* → pi's `DefaultPackageManager` didn't quote the
  non-ASCII/spaced dest path → pre-clone with `spawn("git", [...])` (discrete argv, no shell).
- *No window / no splash* → saved `window-state.json` coords off-screen → clamp bounds to a
  visible display's `workArea`.
- *Fastify startup crash* → bundled node `v22.12.0` hits nodejs/node#58515 → bump to
  `v22.18.0` everywhere (+ CI workflow).

**Phase E — The root-cause hunt (Systematic debugging).** The persistent `Class extends
value undefined` resisted several theories (MAX_PATH, `cpSync` corruption, path encoding).
The break came from **forcing a stack trace** (`NODE_OPTIONS=--stack-trace-limit=200`,
stderr→file), which named `minizlib/dist/commonjs/index.js:178` → the enclosing
`class ZlibBase extends Minipass` where `Minipass` resolved to `undefined`. A *nested*
`minizlib/node_modules/minipass` was an old v3 (`module.exports = Minipass`, no named
export) shadowing the hoisted v7. Fix: bake the confirmed workaround (replace nested
minipass with the npm-level one) into the build script + a correct canary.

**Phase F — Land + harden.** Two logical commits; a second OpenSpec change authored for
the packaging scope; then several follow-ups making the script idempotent (`NODE_FRESH`
pairing, self-healing canary, message-format fixes).

## 4. Prompts that worked

- **The goal prompt** — *"proposal: X. is there anything to clarify?"* is an excellent
  kickoff: it asks the AI to *audit before acting*, which is where it caught the design
  contradictions. Reuse this verbatim before any `apply`.
- **High-leverage parity nudges** — the repeated short *"same as CI?" / "what is used by
  ci?"* prompts were disproportionately effective: each one-liner forced the AI to close a
  real divergence it would otherwise have shipped.
- **Paste-the-raw-error steering** — dropping the exact npm debug log, the Doctor block, or
  the Electron handler stack (no commentary) let the AI diagnose precisely. This is the
  engine of the whole remote loop.
- **Rewrite of a weak prompt:** instead of *"Does not start :("* + screenshot, a faster
  version is *"wizard install failed — here is the full npm debug log and the Doctor output;
  diagnose before proposing a rebuild."* Attach evidence up front, not after a round-trip.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Build a *local* ZIP script that diverged from CI (source-only, no node download, opt-in cache) | Repeatedly asking "same as CI?" | State up front: "the local build MUST match the CI Windows job exactly — full bundle-server, node download, always-on offline cache." |
| Theorize the root cause (MAX_PATH, cpSync corruption, encoding) before evidence | Pasting the actual Doctor / npm log and demanding the stack trace | Force evidence first: capture the stack trace (`NODE_OPTIONS=--stack-trace-limit=200`) before proposing any fix. |
| Pick a canary that checked the *wrong* file (`minizlib/package.json`, which was fine) | Reporting "same error" after the rebuild | Canary must assert the *actual* failure signature (nested `minipass` exports `Minipass`), not a proxy. |
| Reuse a **stale** `resources/node/` because the script skipped download when it existed | Hitting the identical crash build after build | Make artifacts self-healing: verify the culprit file and wipe+re-extract; pair node freshness with cache regeneration. |
| Route around managed npm (use bundled directly) — hiding breakage from server/bridge | "the server and bridge expect the managed install" | Fix, don't bypass: probe managed npm fitness (`node npm-cli.js --version`), fall back only if it's actually broken. |
| Suggest a rebuild before the fix was even observable | "tested" / "same" (round-trips wasted) | Only rebuild when the change is *observable* in the next run; otherwise gather more evidence first. |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was saved in this session — a missed opportunity, because the
**remote-Windows-ZIP first-run debugging loop is highly repeatable**. Recommended skills to
create for next time:

- **`debug-windows-zip-first-run`** — captures the ordered blocker taxonomy (no-node →
  offline-cache-key-mismatch → unquoted-path git clone → off-screen window → bad-node
  Fastify crash → nested-minipass `Class extends undefined`), each with its one-line
  diagnosis and fix. Removes the multi-hour rediscovery cost.
- **`force-node-stack-trace`** — the `NODE_OPTIONS=--stack-trace-limit=200` + stderr-to-file
  recipe that turned an opaque `Class extends value undefined` into a file:line. Invoke
  whenever a packaged Node child process dies without a usable stack.
- A **memory** noting: *bundled-npm version must match the npm that builds the offline cache
  (cache-key format differs npm 10 vs 11)*, and *always prefer `--prefer-offline` + registry
  fallback over hard `--offline`.*

One subagent was spawned (`general-purpose`) to update docs for spawn-failure-diagnostics.

## 7. Pitfalls & dead ends

- **Building the Windows ZIP on macOS/Linux** → `node-pty` prebuilds mismatch (darwin/linux
  in a win32 package) and the offline cache is built with host npm. *If terminals won't work
  in the ZIP, build on a native Windows host (or Docker `electron:build -- --windows`).*
- **`--offline` hard-fails on any cache miss** (e.g. `cross-spawn`). *Use `--prefer-offline`
  and wrap with a live-registry fallback so a broken cache degrades instead of dead-ending.*
- **Stale `resources/node/` silently reused** — the script's `if [ ! -f node.exe ]` guard
  skipped re-extraction. *`rm -rf packages/electron/resources/node
  packages/electron/resources/offline-packages` before a "clean" rebuild, or rely on the
  now-idempotent canary.*
- **Wrong canary file** — checking `minizlib/dist/commonjs/package.json` passed while the
  real culprit (`minizlib/node_modules/minipass`) was broken. *Assert the failure signature,
  not a nearby file.*
- **Failed commands to expect:** a heredoc `cat >>` append to a `.tsx` errored (use `edit`);
  two `npm test` runs exited non-zero from *pre-existing unrelated* failures — grep the log
  (`grep -nE 'FAIL|✗' /tmp/pi-test.log`) instead of trusting the exit code.
- **Non-ASCII/spaced usernames on Windows** (`Róbert Csákány`) break naive shell-quoting and
  mangle console output (CP1252 vs UTF-8). *Always spawn with discrete argv, never a shell string.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A **clean Windows test VM** (ideally with a non-ASCII/spaced username to catch quoting bugs)
  and a **build machine**; a fast rebuild+redeploy path between them.
- The OpenSpec change dir + its artifacts.

**Checklist:**
1. `"proposal: <change>. is there anything to clarify?"` → audit for internal contradictions
   before applying.
2. Apply the change; write source + tests together; verify `tsc --noEmit` then scoped
   `HOME=$(mktemp -d) npx vitest run <file>`.
3. Build the Windows ZIP with the **CI-parity** path: full `bundle-server.mjs`,
   `resources/node/` download, always-on offline cache; on macOS build via Docker.
4. Run the ZIP on the clean VM; on any failure paste the **full** error + `Doctor` output.
5. For opaque native crashes: `NODE_OPTIONS=--stack-trace-limit=200 … 2> trace.txt` → file:line.
6. Ship fix → rebuild → retest **only when the change is observable**.
7. Make the build script self-healing (culprit-file canary, `NODE_FRESH` node/cache pairing).
8. Commit feature and packaging fixes as separate logical commits; author a scoped OpenSpec
   change for the packaging work.

**Final artifacts produced:**
- Source: `packages/server/src/spawn-{preflight,register-watchdog,failure-log}.ts`,
  `packages/client/src/components/SpawnErrorBanner.tsx`, `packages/electron/src/lib/{offline-packages,dependency-installer,window-state}.ts`.
- Build: `packages/electron/scripts/build-windows-zip.sh`, `bundle-offline-packages.mjs`,
  `download-node.sh`, `docker-make.sh`.
- Specs: `openspec/changes/fix-windows-electron-zip-install/{proposal,tasks,specs/*}.md`.
- Commits `090a035` (feat spawn-failure-diagnostics) and `0d7631d` (fix electron-windows),
  plus hardening commits `38dd75b`, `163430b`, `574ca30`, `5ea2442`.

---

_Generated from session `019df054-b1fa-77fe-bd64-c3190e9d8151` · `pi-agent-dashboard` · 2026-05-04. Source extract: `/tmp/facts-Y2knuo.md`._
