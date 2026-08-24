# Test Plan — select-pi-runtime-install

Stage: design   Generated: 2026-08-15

Covers `select-pi-runtime-install` and its companion `fix-tmux-cwd-command-injection`
(one shared implementation vehicle; the injection rows are marked `session-spawn`).

Clarifications resolved before writing (no open markers):
- **Performance scenarios are out of scope for this change** by explicit decision.
  The enumeration cache is still covered behaviourally by E9 (zero repeat
  subprocess spawns) rather than by a latency threshold.
- Unknown-version candidates are selectable **with a warning** (E7, F7).
- Running-session counting uses known-version sessions only; unknowns are
  reported separately (F9, F10).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Candidate discovery — enumerate all locations | EP | L1 | automated | fixture tree with bare-import anchor, managed `node_modules`, npm-global prefix, repo-root `node_modules` all populated | `enumeratePiCandidates()` runs | returns one entry per location, each with `pkgDir`, `spawnEntry`, `moduleEntry`, `version` |
| E2 | Candidate discovery — location absent | EP (invalid partition) | L1 | automated | fixture where managed `node_modules` does not exist | `enumeratePiCandidates()` runs | managed entry present with `path: null`, `version: null` — not omitted from the list |
| E3 | Managed install located inside `node_modules` | EP | L1 | automated | managed pi at `<MANAGED_DIR>/node_modules/@earendil-works/pi-coding-agent`, nothing at `<MANAGED_DIR>/package.json` | `enumeratePiCandidates()` runs | managed candidate reports the real version, not `null` |
| E4 | Per-consumer entry paths are files | EP | L1 | automated | any populated candidate | inspect `spawnEntry` / `moduleEntry` | both are files; `statSync(entry).isDirectory()` is false for every candidate |
| E5 | Candidate usability (non-vacuous drift guard) | state-based invariant | L1 | automated | each enumerated candidate | set `spawnEntry` as the `pi` override and `moduleEntry` as the `pi-coding-agent` override | `resolveExecutor("pi")` yields argv whose script is a real `.js` or executable file, and `resolveModule` imports successfully; a directory value FAILS this assertion |
| E6 | Floor evaluation per candidate | BVA | L1 | automated | candidates at `0.77.9`, `0.78.0`, `0.78.1` against floor `0.78.0` | floor evaluation runs | `0.77.9` flagged below floor; `0.78.0` and `0.78.1` not flagged |
| E7 | Candidate whose version cannot be read | EP (invalid partition) | L1 | automated | executable on `PATH` with no adjacent `package.json` (Windows `.cmd` shim shape) | enumeration runs | entry reported with unknown version, NOT flagged below floor, still selectable |
| E8 | Resolved install outside every known location | EP | L1 | automated | chain resolves pi from a path matching no enumerated candidate | enumeration runs | an extra read-only "current" candidate is returned carrying its own version |
| E9 | Version probing never spawns pi; repeat enumeration re-spawns nothing | fault/observation | L1 | automated | injectable spawn counter wrapping subprocess creation | enumerate twice within one cache generation | zero `pi --version` spawns ever; second enumeration performs zero subprocess spawns of any kind |
| E10 | Enumeration cache invalidated by rescan | state-transition | L1 | automated | enumeration cached, then a candidate's version changed on disk | `rescan()` then enumerate | second enumeration reflects the new version |
| E11 | Override validation — non-existent path | EP (invalid) | L1 | automated | `/nonexistent/pi` | `PUT /api/tools/pi` | 400 naming the failed check; previously active override unchanged |
| E12 | Override validation — directory rejected | EP (invalid) | L1 | automated | a real package **directory** path | `PUT /api/tools/pi` | 400 naming the failed check; no override persisted |
| E13 | Override validation — executable without package version accepted | EP (valid) | L1 | automated | executable file, no adjacent `package.json` | `PUT /api/tools/pi` | accepted; resolution reports unknown version |
| E14 | Atomic dual write — success | decision-table | L1 | automated | spawn=candidate A, import=candidate A | `POST /api/pi/runtime` | both overrides present in the store after one persist |
| E15 | Atomic dual write — persist failure | fault-injection | L1 | automated | injected `persist()` throwing on write | `POST /api/pi/runtime` with both consumers changing | neither override changed on disk AND neither changed in the in-memory cache |
| E16 | `Automatic` clears in the same transaction | decision-table | L1 | automated | both overrides set, then spawn=Automatic, import=candidate A | `POST /api/pi/runtime` | `pi` override removed and `pi-coding-agent` override set, in one persist |
| E17 | Selection takes effect without an explicit rescan | state-transition | L1 | automated | override written via the runtime endpoint | resolve each consumer immediately after | resolution returns the newly selected install, not a stale cached one |
| E18 | Sync derivation — same install, different entries | decision-table | L1 | automated | spawn=`<dir>/dist/cli.js`, import=`<dir>/dist/index.js` | derive sync state | reported in sync (package dirs equal after realpath) |
| E19 | Sync derivation — different installs, same version | decision-table | L1 | automated | two installs both at `0.84.1`, one per consumer | derive sync + divergence | reported NOT in sync AND reported as diverged (both surfaces agree) |
| E20 | Sync derivation — symlinked vs direct path to one install | EP | L1 | automated | spawn via symlink, import via real path, same install | derive sync state | reported in sync (realpath applied before comparison) |
| E21 | Consumer divergence vs install-set divergence | decision-table | L1 | automated | both consumers on `0.84.1`; an unused third install at `0.71.0` | compute both predicates | consumer divergence false; install-set divergence true; the two are reported under distinct labels |
| E22 | Runtime endpoints are network-guarded | EP | L1 | automated | request that the guard rejects | call discovery and selection endpoints | both rejected by the same guard as the existing tool routes |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Sync enabled by default | state-transition | L3 | automated | no overrides; both chains resolve to one install | open Settings → Developer | "Keep both in sync" is checked; both lanes show the same version |
| F2 | Unconfigured install whose chains disagree | state-transition | L3 | automated | no overrides; chains resolve to different installs | open Settings → Developer | sync unchecked AND divergence surfaced; UI does not claim agreement |
| F3 | Pre-existing single-consumer override opens diverged | state-transition | L3 | automated | `pi` override set, `pi-coding-agent` unset, versions differ | open Settings → Developer | sync unchecked, divergence banner naming both versions, existing pin not overwritten on open |
| F4 | Linked selection sets both consumers | decision-table | L3 | automated | sync checked | select a candidate row | both lanes converge to that candidate's version |
| F5 | Divergence cannot be created while linked | state-transition (illegal edge) | L3 | automated | sync checked | attempt any selection in either column | no reachable UI action produces differing lanes |
| F6 | Unlinked selection permits a mismatch | decision-table | L3 | automated | sync unchecked | select candidate A in spawn only | spawn lane changes, import lane unchanged, divergence banner appears |
| F7 | Unknown-version row carries its warning | EP | L3 | automated | candidate with unreadable version present | render the candidate list | that row shows an explicit "version unknown — not floor-checked" warning and remains selectable |
| F8 | Below-floor candidate is disabled with reason | decision-table | L3 | automated | candidate below `piCompatibility.minimum` | click its selection cell in either column | row disabled, reason names the required minimum; neither consumer changes |
| F9 | Running sessions on the previous version are counted | state-convergence | L3 | automated | 2 sessions with known previous version running | apply a spawn change | strip reports exactly 2 sessions still on the previous version |
| F10 | Sessions with unrecorded runtime reported separately | state-convergence | L3 | automated | 1 session with `piVersion` undefined running | apply a spawn change | that session is NOT counted as previous-version; reported separately as unknown runtime |
| F11 | Mismatch restated before it is written | decision-table | L3 | automated | pending selection that diverges | click Apply | confirmation states the resulting mismatch before the write proceeds |
| F12 | No mismatch confirmation when consumers agree | decision-table | L3 | automated | pending selection where both lanes match | click Apply | confirmation does not claim a mismatch |
| F13 | Import change offers a restart; spawn-only does not | decision-table | L3 | automated | (a) import changed (b) spawn only changed | apply each | restart offered in (a), not offered in (b) |
| F14 | Electron non-bundled selection warns but permits | decision-table | L3 | automated | Electron host, select a candidate outside the bundle | select it | warning shown about leaving the bundle; selection remains permitted |
| F15 | Automatic row displays the current resolution | state-transition | L3 | automated | no override set | render the Automatic row | shows the version and location the chain currently resolves to; never blank |
| F16 | Mismatch created outside the picker is detected | state-transition | L3 | automated | override file edited directly to create a mismatch | reopen the section after rescan | divergence surfaced; UI does not claim agreement |
| F17 | Responsive collapse of the selection matrix | state-transition | L3 | automated | viewport width 375px | render the section | metadata full-width above two labelled selection cells; each cell hit area ≥44px; no horizontal overflow |
| F18 | Visual coherence of the runtime section with the rest of Settings | visual/subjective | — | manual-only | the rendered section in each theme | a human looks at it | [judgment: spacing, colour encoding and density read as native to Settings — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | session-spawn — command substitution in workspace path | fault-injection (malicious input) | L2 | automated | directory named with an embedded `$(…)` writing a sentinel file | spawn a tmux session into it | session created for the literal directory name AND the sentinel file does not exist |
| X2 | session-spawn — backtick substitution in workspace path | fault-injection (malicious input) | L2 | automated | directory named with an embedded backtick substitution writing a sentinel | spawn a tmux session into it | sentinel absent; pane cwd is the literal directory |
| X3 | session-spawn — quotes, semicolons and spaces in workspace path | fault-injection (malicious input) | L2 | automated | directory name containing `"`, `'`, `;`, spaces | spawn a tmux session into it | passed as a single argument; no extra command runs; session created |
| X4 | session-spawn — metacharacters in a session flag value | fault-injection (malicious input) | L1 | automated | flag value containing `$(…)`, backticks, quotes | build the tmux invocation | value reaches pi as one literal argument (escaped inside the pane-command element) |
| X5 | tmux invocation is argv, not a shell string | structural invariant | L1 | automated | any tmux spawn | build the invocation | builder returns an argv array; no `cd <cwd> &&` prefix; cwd travels as a literal `-c` element |
| X6 | tmux honours the selected runtime | state-transition | L2 | automated | spawn override pinned to a known install | spawn a tmux session | the pane's command references the resolved install, not a bare `pi` off `PATH` |
| X7 | Node-wrapped invocation keeps its interpreter | EP | L1 | automated | resolution yielding `[node, cli.js]` | build the tmux invocation | both elements carried; spawn does not depend on the script's shebang |
| X8 | wsl-tmux resolves pi inside WSL | decision-table | L1 | automated | wsl-tmux mechanism selected | build the invocation | bare `pi` embedded (WSL-side resolution); no host-resolved path leaks in |
| X9 | headless and Windows Terminal unchanged | regression | L1 | automated | headless and wt mechanisms | build each invocation | both still resolve through the tool registry exactly as before the change |
| X10 | Enumeration survives an unreadable candidate location | fault-injection | L1 | automated | candidate dir present but `package.json` unreadable (permissions) | enumeration runs | that entry reports null version; other candidates still returned; no throw |
| X11 | Enumeration survives a subprocess failure | fault-injection (abort) | L1 | automated | `npm root -g` exits non-zero | enumeration runs | npm-global candidate reported absent; remaining candidates still returned |
| X12 | Malformed override file degrades safely | fault-injection | L1 | automated | corrupt `tool-overrides.json` | open the runtime section | treated as no overrides; section renders Automatic; no throw |
| X13 | Discovery endpoint failure degrades the section | fault-injection (abort) | L3 | automated | `GET /api/pi/installs` returns 500 | open Settings → Developer | section shows an error state; the rest of Settings still renders |

---

## Coverage summary

- Requirements covered: 11/11 (`pi-runtime-selection` 10 + `session-spawn` 1)
- Scenarios by class: edge 22 · perf 0 (out of scope by decision) · frontend 18 · error 13
- Scenarios by level: L1 34 · L2 4 · L3 15 · manual-only 1
- Scenarios by disposition: automated 52 · manual-only 1

## New infra needed

- **L2 tmux spawn harness.** `qa/tests/` has no tmux-spawning test today
  (`16-e2e-memory-bound.sh` is the closest, and it only reads an existing
  harness). X1–X3 and X6 need a qa test that creates adversarially-named
  directories and spawns real tmux sessions into them, then asserts on sentinel
  absence and pane state. This is the one genuinely new harness in the plan —
  everything else extends an existing tier.
- X4/X5/X7/X8/X9 are deliberately routed L1 against the pure builder so the
  security contract has fast coverage that does not depend on the L2 harness
  existing.
