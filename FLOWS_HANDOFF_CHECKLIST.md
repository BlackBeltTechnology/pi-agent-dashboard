# Handoff: Verify pi-flows + Anthropic Bridge + Model Resolution

You are an LLM verifying a target machine so pi-flows, the Anthropic-messages
bridge, and model resolution all work end-to-end in the pi-agent-dashboard.

**Core principle (do not skip): pi AND every peer module resolve from MULTIPLE
independent locations, and those locations can hold DIFFERENT versions.** Never
assume "pi is one thing" or "the peer is on npm". For every item below you must
report the ACTUAL RESOLVED PATH + VERSION at EACH tier, then compare to the
reference baseline. A version string alone is not evidence — a resolved path is.

Two resolution tiers apply to every peer (this is how the code actually probes,
`packages/flows-anthropic-bridge-plugin/src/peer-probe.ts`):

- **Tier 1** — `createRequire(process.cwd() + "/_").resolve(spec)`. Anchored at
  the cwd the SESSION was launched from. Finds peers only in a `node_modules`
  ancestor of that cwd. Throws `MODULE_NOT_FOUND` otherwise.
- **Tier 2** — `resolvePiPackageEntry(spec)` walks `packages[]` in BOTH
  `~/.pi/agent/settings.json` (user scope) and `<cwd>/.pi/settings.json`
  (project scope). Returns an absolute entry path. Does NOT walk
  `extensions[]` / `skills[]`. This is what makes an npm/git/local pi-installed
  peer work even when Tier 1 misses.

A peer counts as PRESENT if Tier 1 OR Tier 2 resolves it. pi-flows additionally
counts as present if a `flow:register-agent-extension` listener exists even when
neither tier resolves the module spec.

---

## REFERENCE BASELINE (a known-good working system)

Match INTENT, not exact paths/versions. The baseline is mixed-source on purpose.

| Fact | Working-system value |
|---|---|
| pi CLI binary | `~/.nvm/.../bin/pi` → `dist/cli.js`, version **0.80.3** (global nvm) |
| pi used by dashboard server / sessions | repo `node_modules/@earendil-works/pi-coding-agent` **0.80.2** (dep spec `^0.80.2`) |
| pi bundled in `packages/server/node_modules` | NONE (server resolves via repo root) |
| piCompatibility floor | `minimum 0.78.0`, `recommended 0.78.0`, `maximum null` |
| pi-flows | LOCAL checkout `/…/pi-flows` **0.3.1** (branch develop), NOT npm 0.3.4; wired in global `packages[]` as a dir path |
| anthropic-messages peer | `npm:@blackbelt-technology/pi-anthropic-messages` **0.3.4**; Tier-1 `createRequire(repo cwd)` MISSES, resolves via Tier-2 (pi `packages[]`) |
| anthropic legacy alias | `@pi/anthropic-messages` (probed second, back-compat) |
| Dashboard plugin packages | `flows-plugin`, `flows-anthropic-bridge-plugin`, `extension`, `shared`, `dashboard-plugin-runtime`, `client-utils` — all **local working tree** (dir paths / `src/**.ts`), NOT `npm:` |
| Bridges (`dashboardPluginBridges` + `packages[]`) | `dashboard-flows`, `dashboard-flows-anthropic-bridge`, `dashboard-goal`, `dashboard-automation` → all LOCAL `src/bridge/index.ts` |
| Dashboard health `bridgeLoadedFrom` | `packages[]` for flows / flows-anthropic-bridge / goal / automation (NOT `dashboardPluginBridges`-only, NOT missing) |
| Dashboard mode | `production` (client bundle built) |
| model:resolve handler | registered in `packages/extension/src/provider-register.ts` (`pi.events.on("model:resolve", …)`) |
| Roles (providers.json) | `planning, coding, fast, research, compact, vision` present; an `activePreset` set |

**The load-source rule that matters most:** a working dev system loads pi-flows +
the dashboard plugins/bridges from the LOCAL WORKING TREE via
`settings.json#packages[]` dir paths — because the published npm dashboard
packages are frozen at `0.5.4` (2026-05-26) and lack the flow/bridge fixes. If
the target loads any of these from `npm:@blackbelt-technology/pi-dashboard-*`,
it is running PRE-FIX code. That is the #1 real-world failure.

---

## CHECKLIST

For each item: run the command, record `resolved path + version + source-tier`,
mark PASS/FAIL against the baseline INTENT, and note which failure-mode row it
triggers.

### 1. pi runtime — enumerate EVERY location (do not assume one)
- [ ] `which -a pi` and `readlink -f "$(which pi)"` — CLI binary path + target.
- [ ] CLI version: `pi --version`.
- [ ] pi the DASHBOARD SERVER resolves: version of
      `<repo>/node_modules/@earendil-works/pi-coding-agent/package.json` AND
      `<repo>/packages/server/node_modules/@earendil-works/pi-coding-agent` if present.
- [ ] pi the SESSION resolves at its launch cwd:
      `node -e "console.log(require('module').createRequire(process.cwd()+'/_').resolve('@earendil-works/pi-coding-agent'))"`.
- [ ] Global nvm/npm copy: `ls -d ~/.nvm/versions/node/*/lib/node_modules/@earendil-works/pi-coding-agent` and any `npm ls -g`.
- [ ] Compare ALL discovered versions. Multiple are OK (baseline has 0.80.3 CLI +
      0.80.2 server) — but EVERY one must be ≥ piCompatibility `minimum` (0.78.0).
- [ ] Dashboard-reported `piVersion` (from `/api/health`) must equal the version
      resolved from the cwd the sessions actually run in — a mismatch means the
      dashboard and the sessions are on different pi's.

### 2. pi-flows engine — which install, which version, which source
- [ ] Find its `packages[]` entry in `~/.pi/agent/settings.json` (dir path? `npm:`? `git:`?).
- [ ] Tier-1: `createRequire(sessionCwd+'/_').resolve('pi-flows')` — record hit/miss.
- [ ] Tier-2: does an entry in user or project `packages[]` resolve to a pi-flows
      entry path? Record the absolute path.
- [ ] Resolve its `package.json` `name` + `version`. Baseline: name
      `@blackbelt-technology/pi-flows`, local checkout `0.3.1` (develop).
- [ ] Confirm it is NOT the unrelated unscoped `pi-flows` (a different third-party
      package @ `0.1.1`). Name MUST be `@blackbelt-technology/pi-flows`.
- [ ] If loaded from a local checkout, record the branch + HEAD commit and confirm
      it contains the flow-engine + model-resolution fixes (e.g. commit touching
      `fix-flow-agent-model-resolution`). If npm, version MUST be ≥ 0.3.2.

### 3. anthropic-messages peer — rename skew + tier awareness
- [ ] `packages[]` entry present for `@blackbelt-technology/pi-anthropic-messages`
      (new name) OR `@pi/anthropic-messages` (legacy)? Record which.
- [ ] Tier-1: `createRequire(sessionCwd+'/_').resolve('@blackbelt-technology/pi-anthropic-messages')`
      — record hit/miss. (Baseline MISSES from the dashboard repo cwd — that is
      acceptable ONLY if Tier-2 hits.)
- [ ] Tier-1 for the legacy name too.
- [ ] Tier-2: resolve via pi `packages[]`. At least ONE of {new, legacy} MUST
      resolve via Tier-1 or Tier-2, or the bridge will sit in `waiting_peers`.
- [ ] Record resolved version. Baseline npm `0.3.4`.
- [ ] Confirm the bridge code being loaded probes the NEW name first (stale bridge
      builds only knew the legacy name → rename-skew miss). See item 5.

### 4. Dashboard packages — SOURCE is the whole game
- [ ] For `flows-plugin`, `flows-anthropic-bridge-plugin`, `extension`, `shared`,
      `dashboard-plugin-runtime`, `client-utils`: is each loaded from a LOCAL dir
      path / `src/**.ts` OR from `npm:@blackbelt-technology/pi-dashboard-*`?
- [ ] For any `npm:` source, get the installed version. If `0.5.4`, it is the
      FROZEN pre-fix snapshot — FAIL (missing the flow availability/bridge fixes).
- [ ] Baseline: ALL local working tree. A dev system must load local; only a
      released ≥ 0.5.5 npm set is acceptable as an alternative.
- [ ] Confirm the local sources are on `develop` and up to date (`git status`,
      `git log origin/develop..HEAD`). Uncommitted changes in flows/bridge/
      extension that are NOT on the target = a divergence source — list them.

### 5. Bridge registration + activation (all four bridges)
- [ ] `~/.pi/agent/settings.json#dashboardPluginBridges` lists
      `dashboard-flows`, `dashboard-flows-anthropic-bridge`, `dashboard-goal`,
      `dashboard-automation` → record the path each points at (local vs npm).
- [ ] The SAME bridges must ALSO appear in `packages[]` — pi reads `packages[]`,
      NOT `dashboardPluginBridges`. If a bridge is ONLY in
      `dashboardPluginBridges`, pi never invokes it (the "no sessions reporting"
      bug; fix = dashboard ≥ 0.5.4 writes both + restart runs
      `reconcilePluginBridgePackages`).
- [ ] The flows-anthropic-bridge dashboard plugin is ENABLED (disabled →
      auto-deregistered → no bridge entry at all).
- [ ] Anthropic bridge status: probe `/api/health` for the
      `flows-anthropic-bridge` plugin and its status. Expect `active`. If
      `waiting_peers`, read the `peers` sub-object — it names WHICH peer
      (`@…/pi-anthropic-messages` or `pi-flows`) failed and the Tier-1 `reason`.
- [ ] Remember: the bridge re-probes ONLY on `session_start` and wires hooks once
      per process. Peers installed mid-session need a FRESH session (respawn /
      full `/reload`), not just a config edit.

### 6. Client build + component reload state (the "I built it" trap)
- [ ] Dashboard `mode` from `/api/health`: `production` or `dev`?
- [ ] If `production`: was `npm run build` re-run AFTER the last pull? Compare
      `dist/client` mtime to the latest flows-plugin/extension source commit. The
      flows-plugin RENDER code is COMPILED INTO the client bundle at build time —
      current source with a stale bundle = old UI.
- [ ] Was the server restarted (`POST /api/restart`) after server/shared changes?
- [ ] Was `npm run reload` run so LIVE pi sessions pick up the new BRIDGE
      (`packages/extension`)? Building the web client does NOT reload the bridge.
- [ ] Confirm the three-component matrix is satisfied:
      client→build+restart, server→restart, extension/bridge→reload (or fresh session).

### 7. Model resolution wiring
- [ ] `packages/extension/src/provider-register.ts` registers
      `pi.events.on("model:resolve", …)` (and the deprecated
      `role:resolve-model` alias). Confirm the loaded extension source has it.
- [ ] `~/.pi/agent/providers.json` has `roles` (baseline:
      `planning, coding, fast, research, compact, vision`), `rolePresets`, and an
      `activePreset`.
- [ ] Every role referenced by a flow/agent resolves to a real model ref
      (`@role` → `provider/model[:thinking]`). A flow agent whose model is an
      unresolvable `@role` will fail at spawn.
- [ ] pi-flows version must be one that consumes `model:resolve` (the
      `fix-flow-agent-model-resolution` / `consume-model-resolve-event` line). A
      pre-fix pi-flows ignores the handler → agents fall back / fail.
- [ ] The provider backing the active preset has valid credentials
      (`/api/models` returns the expected catalogue; provider-auth handler present).

### 8. End-to-end smoke (only after 1–7 pass)
- [ ] Launch a fresh session in the intended project cwd.
- [ ] `/api/health` → mode correct, `piVersion` matches session pi, all four
      bridges `bridgeLoadedFrom: packages[]`, anthropic bridge `active`.
- [ ] Run a flow from the session-card "Run Flow…" launcher. Confirm the flow
      appears (availability gate open), agents spawn, and each agent's model
      resolved (no `@role` errors). Confirm `flow_*` events render live.

---

## FAILURE-MODE MAP (diagnose from the checks above)

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard `piVersion` ≠ session pi | pi resolved from two locations | align repo dep + global; verify cwd resolution |
| pi-flows not found | wrong package (unscoped `pi-flows@0.1.1`), or not in `packages[]` | install `@blackbelt-technology/pi-flows` (≥0.3.2 npm or local develop) into `packages[]` |
| anthropic bridge `waiting_peers` (am peer) | Tier-1 miss + no Tier-2 entry, or rename skew | add peer to `packages[]`; ensure bridge probes new name first (load local/≥0.5.5 bridge) |
| anthropic bridge `waiting_peers` (pi-flows peer) | pi-flows not resolvable from cwd + no listener | add pi-flows to `packages[]`; respawn session |
| bridge "no sessions reporting" | bridge only in `dashboardPluginBridges` | dashboard ≥0.5.4 writes both; restart to run reconcile |
| flows don't render but flow runs | flows-plugin from npm 0.5.4 (pre-fix), or stale client bundle | load local flows-plugin OR release ≥0.5.5; `npm run build` + restart |
| "I built it, still broken" | bridge not reloaded into live sessions | `npm run reload` / fresh session; then `POST /api/restart` |
| agent model fails at spawn | `@role` unresolvable, or pre-fix pi-flows ignoring `model:resolve` | fix roles/providers.json; upgrade pi-flows to model-resolve-aware version |
| plugin disabled | flows-anthropic-bridge dashboard plugin off | enable it → bridge auto-registers |

## REPORT FORMAT
For each numbered section return: `PASS/FAIL`, the resolved path(s) + version(s)
per tier, and — on FAIL — the matching failure-mode row + the exact remediation
command. Do NOT report a version without the resolved path it came from.
