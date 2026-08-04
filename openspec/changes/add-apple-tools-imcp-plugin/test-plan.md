# Test Plan — add-apple-tools-imcp-plugin

Stage: design   Generated: 2026-08-03

## ⚠ Clarifications carried (1)

- [ ] **C1** — X9: iMCP's concrete permission-class error shape is unknown (third-party, not in repo). Deferred by decision: pin the real error string/code during implementation against a live provisioned host, then replace the marker.

> Four gaps were raised at the HARD gate; three were answered and are now concrete in the rows below (P1 thresholds, X4 brew timeout, F7 cache invalidation). C1 is a deliberate defer.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Platform gate | decision-table | L1 | automated | injected `platform="linux"` | installer invoked | state `UNSUPPORTED_PLATFORM`, exit 0, 0 filesystem writes, 0 subprocess spawns |
| E2 | Platform gate | decision-table | L1 | automated | injected `platform="win32"` | installer invoked | identical to E1 (no Windows-specific branch) |
| E3 | Platform gate | decision-table | L1 | automated | injected `platform="darwin"` | installer invoked | traversal proceeds to version probe; `sw_vers` called exactly once |
| E4 | Minimum macOS version | BVA | L1 | automated | `sw_vers` → `15.2` | version gate | `OS_TOO_OLD`, non-zero exit, message names both `15.2` and `15.3` |
| E5 | Minimum macOS version | BVA | L1 | automated | `sw_vers` → `15.3` | version gate | gate passes (inclusive floor), traversal continues to discovery |
| E6 | Minimum macOS version | BVA | L1 | automated | `sw_vers` → `15.10` | version gate | gate passes — numeric compare, NOT lexical (`"15.10" < "15.3"` as strings) |
| E7 | Minimum macOS version | BVA | L1 | automated | `sw_vers` → `26.0` | version gate | gate passes (no upper bound regression) |
| E8 | Minimum macOS version | BVA | L1 | automated | `sw_vers` → `14.6` | version gate | `OS_TOO_OLD`, non-zero, no filesystem write |
| E9 | Unreadable version | decision-table | L1 | automated | `sw_vers` absent / exits 1 / empty stdout | version gate | `OS_VERSION_UNKNOWN` (NOT `OS_TOO_OLD`), message asserts no detected version |
| E10 | Application discovery | decision-table | L1 | automated | override unset, `/Applications/iMCP.app/…/imcp-server` exists | discovery | that path recorded, install branch skipped |
| E11 | Application discovery | decision-table | L1 | automated | `/Applications` absent, `~/Applications/…/imcp-server` exists | discovery | user-local path recorded, install branch skipped |
| E12 | Application discovery | decision-table | L1 | automated | override set to an existing path, `/Applications` ALSO exists | discovery | override wins; candidate list not consulted |
| E13 | Application discovery | decision-table | L1 | automated | override set to a NON-existent path, `/Applications` exists | discovery | falls through to candidate list (override is a preference, not a veto) — pins the precedence contract |
| E14 | Terminal state closure | decision-table | L1 | automated | every injected combination across platform × version × app × brew × config | full traversal matrix | reported state ∈ the 9-member enum on every path; no unnamed error escapes |
| E15 | Terminal state distinctness | decision-table | L1 | automated | cask fails / config unparseable / config unwritable | three separate traversals | `INSTALL_FAILED` / `CONFIG_UNPARSEABLE` / `CONFIG_WRITE_FAILED` respectively — no two collapse |
| E16 | `paths` probe | EP | L1 | automated | manifest declares an existing absolute path | probe runs | `paths[0].satisfied === true` |
| E17 | `paths` probe | EP | L1 | automated | manifest declares a non-existent absolute path | probe runs | `satisfied === false` AND name present in `missingRequirements` |
| E18 | `paths` probe | BVA | L1 | automated | existing absolute path containing spaces (`/Applications/My App.app/…`) | probe runs | `satisfied === true` — no character denylist rejects it |
| E19 | `paths` probe | EP | L1 | automated | relative path `./imcp-server` | probe runs | `satisfied === false`, not resolved against cwd |
| E20 | `paths` probe | EP | L1 | automated | path containing `;` `&&` `$()` | probe runs | treated as an opaque path; no shell spawned (assert 0 child processes) |
| E21 | `${configKey}` interpolation | decision-table | L1 | automated | config sets `imcpServerPath` to an existing absolute path | probe runs | satisfied; resolved value equals the config value |
| E22 | `${configKey}` interpolation | decision-table | L1 | automated | config leaves the key at schema default | probe runs | resolves the default; behaves identically to an equivalent literal |
| E23 | `${configKey}` interpolation | decision-table | L1 | automated | placeholder names a key absent from `configSchema` | probe runs | unsatisfied, no throw, other three categories still probed |
| E24 | `${configKey}` interpolation | decision-table | L1 | automated | key resolves to a relative path | probe runs | unsatisfied, no throw |
| E25 | Backward compatibility | EP | L1 | automated | manifest with `requires: {piExtensions, binaries}` only | probe runs | `report.paths === []`; `missingRequirements` content AND ordering byte-identical to pre-change baseline |
| E26 | Backward compatibility | EP | L1 | automated | manifest with no `requires` at all | probe runs | `missingRequirements === []`, no throw |
| E27 | Idempotency | state-transition | L1 | automated | fully provisioned host | installer run twice | second run reports same state; exactly one `mcpServers.iMCP` key; ≤1 adapter entry in `packages[]` |
| E28 | Idempotency | state-transition | L1 | automated | `packages[]` with 23 pre-existing entries | installer appends | all 23 retain original relative order; none removed |
| E29 | Cross-kind dedup | decision-table | L1 | automated | `packages[]` already holds a **git-sourced** `pi-mcp-adapter` | installer runs | no npm duplicate appended (exercises `sourcesMatch()`, which `===` would miss) |
| E30 | Opt-in invocation | decision-table | L1 | automated | package installed as a dependency | `npm install` completes | 0 provisioning traversals, 0 `brew` invocations; manifest has no `postinstall`/lifecycle script |
| E31 | Check mode | decision-table | L1 | automated | unprovisioned macOS host | `--check` | reports the state it *would* reach; 0 files created/modified; `brew` never invoked |
| E32 | Check/write parity | decision-table | L1 | automated | identical injected host state | `--check` vs write-mode dry comparison | both report the same terminal state (one implementation, no divergence) |
| E33 | Reconciliation guard | decision-table | L1 | automated | operator override set explicitly; server check discovers a different path | server check runs | override left unmodified — write-back fires only on unset/default |
| E34 | Bundle completeness | decision-table | L1 | automated | `apple-tools` present under `packages/` with a plugin manifest | `bundled-plugins-complete.test.ts` runs | test passes — id present in `BUNDLED_PLUGINS` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Skill load-time check (macOS) | tail-latency | L1 | automated | 100 sequential skill-load checks, injected probes | p95 < 200ms | single run |
| P2 | Skill load-time check (non-macOS) | tail-latency | L1 | automated | 100 sequential checks, `platform="linux"` | p95 < 5ms AND 0 subprocesses spawned | single run |
| P3 | Probe cache effectiveness | threshold | L1 | automated | 2 probes inside the cache window | second probe performs 0 filesystem stats | single run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Missing-requirement rendering | state-transition | L3 | automated | plugin row with an unsatisfied `paths` requirement | Plugins tab rendered | a warning pill naming the requirement is present; the block is NOT empty (regression guard for the three-category client bug) |
| F2 | Missing-requirement rendering | decision-table | L3 | automated | unsatisfied `paths` requirement | Plugins tab rendered | NO inline `[Install]` button (a path has no package source) |
| F3 | Missing-requirement rendering | decision-table | L3 | automated | unsatisfied `pi-mcp-adapter` `piExtensions` requirement | Plugins tab rendered | `[Install via Packages tab]` link, NOT an inline `[Install]` button (no curated entry) |
| F4 | Settings section placement | state-transition | L3 | automated | provisioned host, plugin enabled | settings-gear affordance on the plugin row clicked | section renders inline beneath that row; assert it renders on NO other settings page |
| F5 | Settings section placement | decision-table | L3 | automated | plugin disabled in config | Plugins tab rendered | claim filtered out; no section rendered |
| F6 | Panel state readout | state-transition | L3 | automated | unprovisioned macOS host | panel rendered | displays the shared checker's terminal state; vocabulary identical to the CLI's for the same host |
| F7 | Cache invalidation | state-transition | L3 | automated | panel showing an unprovisioned state | `[Run installer]` completes, then config write | cache cleared on both events; panel converges to the new state without a manual reload |
| F8 | Non-macOS inert panel | decision-table | L3 | automated | dashboard on a non-macOS host | panel rendered | unsupported-platform readout; `[Run installer]` action absent |
| F9 | No service toggles | decision-table | L3 | automated | fully provisioned host | panel rendered | 0 controls purporting to toggle an individual Apple service; pending-grants copy delegates to the menu bar and states grants cannot be automated |
| F10 | Disable override isolation | state-transition | L3 | automated | provisioned host | operator toggles the iMCP server off | `disabled` written to project-local `.pi/mcp.json`; `~/.pi/agent/mcp.json` `command` entry byte-identical |
| F11 | Disabled ≠ ready | decision-table | L3 | automated | server disabled AND host provisioned | panel rendered | status does not simultaneously read `READY_PENDING_GRANTS` and `disabled` — disabled state folds into the readout |
| F12 | Panel visual fit across themes | visual/subjective | — | manual-only | panel in each of the 4 themes | human looks | [judgment: readable, consistent with sibling plugin sections — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Guarded installation | fault-injection (abort) | L1 | automated | `brew` absent from PATH, app absent | traversal reaches install branch | `NO_INSTALL_METHOD`, non-zero, message contains the direct download URL |
| X2 | Guarded installation | fault-injection (abort) | L1 | automated | `brew install --cask` exits 1 with stderr | install branch | `INSTALL_FAILED`; brew's stderr surfaced verbatim; 0 retries; 0 config writes |
| X3 | Shell-injection resistance | fault-injection | L1 | automated | discovered path containing `; rm -rf /` | brew + all subprocess call sites | `brew` invoked with an argv array; assert no probed value ever reaches a shell string |
| X4 | brew timeout | fault-injection (delay) | L1 | automated | `brew` stalls indefinitely | install branch | terminates at 10 min with `INSTALL_FAILED` and a timeout-specific message; no config write |
| X5 | Post-brew re-discovery | fault-injection | L1 | automated | cask exits 0 but no binary at any candidate | re-discovery gate | `INSTALL_FAILED`; NO mcp.json entry written (guards the silent-broken-entry mode) |
| X6 | Merge-only mcp.json write | fault-injection | L1 | automated | config holds an unrelated `mcpServers.other` entry + unknown top-level keys | installer writes | both survive verbatim alongside the new `iMCP` entry |
| X7 | Unparseable mcp.json | fault-injection (abort) | L1 | automated | config file present, invalid JSON | installer writes | `CONFIG_UNPARSEABLE`, non-zero, parse error reported, original file byte-identical |
| X8 | Unparseable settings.json | fault-injection (abort) | L1 | automated | settings file present, invalid JSON | installer appends | `CONFIG_UNPARSEABLE`, original byte-identical (parity with X7 — the invariant covers both files) |
| X9 | TCC revocation attribution | fault-injection | L3 | automated | provisioned host, grant revoked out of band | Apple-data tool called | [NEEDS CLARIFICATION: observable — iMCP's concrete permission-class error shape is unknown; pin against a live host during implementation] |
| X10 | Atomic write (mcp.json) | fault-injection (abort) | L1 | automated | write interrupted mid-rename | installer writes | file is complete-old or complete-new; never truncated |
| X11 | Atomic write (settings.json) | fault-injection (abort) | L1 | automated | write interrupted mid-rename | installer appends | as X10 |
| X12 | Unwritable config | fault-injection (abort) | L1 | automated | parseable config, `EACCES` on rename | installer writes | `CONFIG_WRITE_FAILED` (NOT coerced to `CONFIG_UNPARSEABLE`), original byte-identical |
| X13 | Unwritable config | fault-injection (abort) | L1 | automated | `ENOSPC` on rename / uncreatable parent dir | installer writes | `CONFIG_WRITE_FAILED`, original byte-identical |
| X14 | No credential leakage | fault-injection | L1 | automated | a sibling MCP config layer contains a secret-bearing entry | installer writes | no value from any other layer appears in the written file |
| X15 | CLI ↔ server store isolation | fault-injection | L1 | automated | no dashboard server running | CLI installer runs | completes normally; writes exactly 2 files; never reaches `updatePluginConfig` |
| X16 | Doctor probe isolation | fault-injection | L1 | automated | Apple-tools package absent from the host | doctor runs | probe reports package absent; every other doctor probe completes normally |
| X17 | Doctor probe is read-only | fault-injection | L1 | automated | any host state | doctor probe runs | 0 config files created/modified; 0 install attempts |
| X18 | Doctor/CLI verdict parity | decision-table | L1 | automated | identical injected host state | doctor probe vs CLI `--check` | identical terminal state |
| X19 | Non-macOS is not a fault | decision-table | L1 | automated | doctor on Linux | doctor runs | Apple-tools probe reports unsupported-platform and is NOT flagged as requiring remediation |
| X20 | Mail redirect | decision-table | L1 | automated | agent asked to search Apple Mail | skill consulted | skill states iMCP exposes no Mail service and names `apple-mail-fast-export`; 0 iMCP tool calls attempted |
| X21 | Messages ≠ email | decision-table | L1 | automated | agent evaluates whether "Messages" satisfies an email request | skill consulted | documentation identifies Messages as iMessage/SMS only |
| X22 | Unprovisioned skill load | state-transition | L1 | automated | macOS host, no iMCP app | skill loads | reports the gap, names the installer command, attempts 0 Apple-data tool calls |
| X23 | Cross-platform suite determinism | fault-injection | L1 | automated | full installer suite on Linux CI | `npm test` | every scenario passes via injected probes; 0 reads of a real `/Applications` path; 0 real `brew` invocations |

---

## Coverage summary

- Requirements covered: 30/30
- Scenarios by class: edge 34 · perf 3 · frontend 12 · error 23 — **72 total**
- Scenarios by level: L1 **56** · L2 0 · L3 **15** · manual-only 1
- Scenarios by disposition: automated **71** · manual-only **1**

## New infra needed

None. L1 lands in `packages/*/src/**/__tests__/*.test.ts` (vitest); L3 lands in `tests/e2e/*.spec.ts` against the docker harness on its `.pi-test-harness.json` `dashboardPort` (hash-derived per worktree — never hardcode `:18000`).

**No L2 rows.** This change ships no cross-OS process/runtime surface: the installer is macOS-only and fully probe-injected at L1, and the dashboard surface is rendered UI (L3 by the level boundary). A `qa/tests/*.sh` row would be a downgraded duplicate of an L1 scenario.
