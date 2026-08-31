# Findings — investigate-bridge-cwd-asymmetric-immunity

## Answer to the parent's Open Question (task 7.1), in one paragraph

**Revised after the isolated replay (Part 2 below) — there is no cwd-dependent
discovery decision.** The "repo arm that kept its bridge — twice, 2 h apart" was
not a matrix arm but repo-cwd **control sessions** (23:33 + 01:52, 08-10/11), and
their apparent immunity is fully explained by two ordinary effects: (1) the
**boot-time mDNS retarget race** — `autoStartServer` resolves `find(s =>
s.isLocal)` over same-host advertisers (1 live + 3 stale rogue dashboards that
night), and whichever resolves with a `piPort ≠ config.piPort` triggers
`connection.updateUrl()` → forced reconnect to an unreachable endpoint → the
silent-death signature; (2) **survivorship bias** — sessions whose boot race
resolved the live server lived long enough to be observed "keeping" their
bridge, while quick probes that died still counted as "working" because their
prompts were delivered before the bridge dropped. The flip replay demoted the
last surviving cwd hypothesis (extension load-source vintage): under full
parity both load sources die at equal rates (0.7.0-published 3/7 vs
working-tree-pinned 4/7). The real, reproduced defect is the migration hijack
itself — already fixed behaviourally by #569.

---

## 1.1 Matrix-window forensics — per-arm timelines

Two arm bursts exist in the entire 16 MB `~/.pi/dashboard/server.log`; there is **no third**.
The proposal's table derives from the **08-10 matrix only**. The 08-29 burst is the parent
change's deferred task-6.x re-run harness (leaked arms), not the source observation.

### 08-10 seven-arm matrix + controls (rogue same-host dashboards era)

Spawned by session `019feda3-8d51` (cwd main repo) via the dashboard API. Times are
uuidv7-decoded spawn instants (first 12 hex chars); line numbers are global
`server.log` lines. No `[bridge-transport]` lines exist for any of these sids — transport
diagnostics landed 2026-08-24 (#534), so resolution-time evidence is absent for this matrix.

| role | sid (prefix) | cwd | spawn (UTC) | registered | closed | timed out | outcome |
|---|---|---|---|---|---|---|---|
| ARM | 019fee00-0d4e | /private/tmp/wedge-repro | 23:26:48 | 30785 | 30787 | 30877 | migrated → 502 |
| ARM | 019fee04-d9e8 | /private/tmp/wedge2 | 23:32:03 | 30861 | 30863 | 30958 | migrated → 502 |
| ARM | 019fee15-7ee9 | /private/tmp/w-a | 23:50:13 | 31130 | 31132 | 31234 | migrated → 502 |
| ARM | 019fee15-b6e3 | /private/tmp/w-b | 23:50:28 | 31138 | 31139 | 31239 | migrated → 502 |
| ARM | 019fee15-f233 | ~/Project/zz-spawn-test-c | 23:50:43 | 31145 | 31147 | 31246 | migrated → 502 |
| ARM | 019fee17-50c3 | ~/Project/pi-chainlint | 23:52:13 | 31169 | 31170 | 31221 | migrated → 502 |
| ARM | 019fee1b-c75d | /private/tmp/p2-fail | 23:57:05 | 31251 | 31253 | 31345 | migrated → 502 |
| ARM | 019fee1c-c29b | /private/tmp/p2b | 23:58:10 | 31272 | 31274 | 31365 | migrated → 502 |
| CTRL | 019fee05-c61e | ~/Project/pi-agent-dashboard | 23:33:03 | 30882 | 30899 | 30953 | prompt delivered 23:33:54 ✅, bridge later dropped |
| CTRL | 019fee07-9342 | ~/Project/pi-agent-dashboard | 23:35:01 | 30917 | — | — | **kept bridge**: 130 log lines, re-registered 32483, 32891 |
| CTRL | 019fee17-cb38 | ~/Project/pi-agent-dashboard | 23:52:44 | 31179 | 31199 | 31241 | quick probe; bridge later dropped |
| CTRL | 019fee1c-00cb | ~/Project/pi-agent-dashboard | 23:57:20 | 31259 | 31351 | 31404 | quick probe; bridge later dropped |
| CTRL | 019fee28-2e7c | ~/Project/pi-agent-dashboard | 00:10:38 | 31455 | — | — | **kept bridge**: 27 lines, re-registered 32485, 32886 |
| CTRL | 019fee5d-4922 | ~/Project/pi-agent-dashboard | 01:08:38 | 32064 | — | — | **kept bridge**: 37 lines, re-registered 32484, 32894 |

Notes:
- Every death signature is `connection closed` while the pi process stayed alive, then
  heartbeat-grace expiry — the silent-migration signature; no `unregistered (explicit)`
  anywhere in the burst.
- The proposal's "twice, 2 h apart" = controls 23:33 (08-10) + 01:52 (08-11), 2 h 19 min
  apart. The 01:52 control sits beyond the extracted line range; it is evidenced by the
  transcript table only, and is consistent with the three long-lived re-registering
  sessions above.
- The mass re-registration cluster at lines 32478–32517 (many sids together) is a server
  restart recovery event; the three surviving controls re-register through it — they never
  left the live server.
- Rogue endpoints at this time: stale worktree dashboards on this host
  (pids 57310/78840/19320, e.g. advertised as `home-imac-54922.local:9594`), uptime ~22–23 h
  (transcript 08-10 22:18:18). The iMac-named stale dashboards seen on 08-28/29 are the
  user's LAN iMacs, a different stale-advertisement era, same mechanism.
- Causal chain as instrumented by the parent (transcript 08-10 23:59:57): connect ✅ →
  register ✅ → mDNS discovery finds rogue → **bridge migrates** → `[gateway] connection
  closed` → rogue unreachable (binds 127.0.0.1) → 502 forever. P2 probes proved the
  extension never closed intentionally (`ConnectionManager.disconnect()` never called) and
  the reconnect never happened.

### 08-29 re-run waves (parent task-6.x harness; leaked arms — NOT the source matrix)

All times UTC 2026-08-29; window.log line = global − 132997. Every arm registration carries
`token=` **empty** with `[event-wiring] cwd-FIFO fallback` linking — the env-inheritance
harness defect the parent itself diagnosed at 13:04:53 (arm bridges inherited the parent's
`PI_DASHBOARD_SOCKET`). Every arm shows exactly one
`endpoint_resolved: ws+unix:///Users/robson/.pi/dashboard/gateway-9999.sock:/
(source=PI_DASHBOARD_SOCKET pinned=true)` — i.e. all arms, **including the six that later
502'd and the repo arm**, started pinned to the live gateway.

| wave | sids | spawn | lifecycle |
|---|---|---|---|
| 1 (7 arms + w-legit 01a04d98-e435) | 01a04d98-6c7d/-6cbb/-6ce0/-6cd0/-6cf4/-6cf8/**-6d05 (repo)**/-e435 | 12:57:10 (all within 136 ms) | registered (win 22210–22251) → **mass close 22332–22339** → grace → timed out 22509+ (repo arm: closed 155333, timed out 155506) |
| 2 (7 arms + w-legit 01a04da1-1ec6) | 01a04da0-7420/-7480/-7468/-7487/-74a9/-74ba/**-7499 (repo)** + 01a04da1-1ec6 | 13:05:56 | 1× pinned=true each; ended `unregistered (explicit)` at teardown (22459+; repo arm 155454) |

Interpretation: the wave-1 mass close at 22332–22339 occurred **before** the
`2026-08-29-130500` automation-run label (win 22364) and matches the parent's
run-verify.sh v1 420 s timeout kill at 13:03:47 (parent transcript). The waves therefore
show the harness killing its own pinned arms — they do **not** reproduce (or refute) the
08-10 asymmetry, and the parent's later fully-isolated batch (13:09+, post-rewrite, arms
resolving to temp gateways `/tmp/pi-mdns-home-*/…gateway-19101.sock`) never registered on
this server at all (zero log rows). A third `retarget_refused` class (34 lines in-window)
belongs exclusively to *earlier organic* sessions refusing stale iMac endpoints —
evidence the post-#534 stickiness worked for sessions that hit `decideRetarget`.

## 1.2 Keeper-log inventory (extension-side output)

| arm batch | keeper-<sid>.log present? | capturePiOutput at the time |
|---|---|---|
| 08-10 arms (019fee00/04/15×3/1b/1c) | **none** (checked `~/.pi/dashboard/sessions/`, `editors/`) | `false` (reverted 08-10 22:43, before the 23:26 arms) |
| 08-10 repo controls (019fee05/07/17-cb38/1c-00cb/28/5d) | **none** | `false` |
| 08-29 wave 1/2 arms (01a04d98-*, 01a04da0-*, 01a04da1-*) | **none** | `false` |

Extension-side output survives only via the investigating sessions' transcripts (P2 probe
results quoted above). Everything else about bridge-side decisions at those instants is
absent from disk — this is the permanent evidence hole that any replay must close with
`keeperLog.capturePiOutput=true` (task 3.3).

## 1.3 Server commit, mechanism presence, window drift

| matrix | server code root | commit at matrix time | spawn pin (`buildSpawnEnv` PI_DASHBOARD_URL/SOCKET) | D3 pinned-resolution ladder | migration guard |
|---|---|---|---|---|---|
| 08-10 23:26–01:52 | main repo working tree (clean) | **48e9c64d7** (08-10 18:25, #456; next commit b1d5bc031 is 08-11 03:54) | **absent** (arm registrations carry no token linkage; endpoint-resolution.ts does not exist yet — first landed 08-24 #534 as 67adeaf57) | **absent** (same) | **absent** (guard landed 08-29 #569 as 172c8ffea) |
| 08-29 12:57/13:05 waves | live server = develop (pre-#569); fix worktree held the guard as uncommitted WIP | n/a (running tree ≠ commit) | present (server-injected `PI_DASHBOARD_SOCKET`; observed pinned=true on every arm) | present (#534) | **absent** at 12:57 (landed 16:40 that day) |

Window drift, 08-10 23:00→08-11 02:30 (per-arm code-vintage dimension): five commits landed
(736c1d269, 12eeaafaf, b51f19b39, fd530bc61, e52a1b518) — none modifies
`packages/extension/**` per their subjects (client/scripts/docs/skills; not diffed
file-by-file — caveat). The working-tree extension vintage was therefore **constant across
all arms all night**; the vintage that differs per cwd is the *load source* (1.4), not the
working tree.

Decisive static fact for the 08-10 vintage: at 48e9c64d7/b1d5bc031,
`packages/extension/src/bridge.ts` imports `discoverDashboard` from
`@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js` but **never calls it** —
discovery in the working-tree source is reachable only from the startup/auto-start path
(`server-auto-start` tests). Mid-session migration code did not exist in this source;
`retarget` vocabulary enters the extension only with #534 (08-24).

## 1.4 Extension load source / load count per arm (H-dual-load static half)

| arm (by cwd) | local extension-declaring surface | bridge load source | registrations × waves | disambiguation |
|---|---|---|---|---|
| /private/tmp/* (wedge-repro, wedge2, w-a, w-b, p2-*) | none (no `.pi/`, no `package.json` pi field) | pi bundled/published build | 1 each | — |
| ~/Project/zz-spawn-test-c | none (bare git) | bundled/published | 1 | — |
| ~/Project/pi-chainlint | `.pi/` + `openspec/` present but **no** pi-extension declaration tying it to the dashboard repo | bundled/published | 1 | kills "having a `.pi/`" as the protector |
| ~/Project/pi-agent-dashboard (repo + its worktrees) | root `package.json` `pi.extensions: ["packages/extension/src/bridge.ts"]` (+ `.pi/settings.json` skills entry) | **working-tree TypeScript, loaded per session start** | 1 per session; long-lived controls re-registered (3×) on reconnect/restart | re-registration is not cwd-exclusive: organic repo-*worktree* session 01a04d06-47f3 also re-registered 3× (08-29 window lines 18201/18726/20615) |

Dual-load disambiguation (raw line counts cannot decide it; this evidence can):
- Parent's P2 instrumentation (08-10 23:57:54): `initBridge` ran **exactly once** in both a
  working arm and the failing arm (`prevGen=0`, no cleanup); `disconnect()` never called in
  the failing arm. Single load on both sources.
- Server-side: exactly one registration per sid per wave for every arm in both matrices.
- No `/reload` events and no server restart coincide with any arm registration burst
  (08-29: launches bracket the burst 11:38:07Z → 21:47:07Z with none inside; 08-10: none
  logged in the burst interval).

## 1.5 Spawn route / env / start-time (H-resolution-path forensic half)

| check | result |
|---|---|
| All arms dashboard-spawned, "varying only cwd" | confirmed for 08-10 by the spawning transcript (single spawner session `019feda3`, dashboard API, prompt delivery via `POST /prompt`); 08-10 registration lines predate the `token=`/pid log format, so token-level confirmation for that night is a recorded caveat. 08-29 waves: confirmed with the harness defect (`token=` empty, cwd-FIFO fallback). |
| Explicit `SessionOptions.extensions` per spawn | none found in either transcript — no spawn overrode the extension set; the cwd-derived load surface is the only route input that varied |
| Per-arm start times | 08-10: arms 23:26:48→23:58:10, controls 23:33:03→01:08:38 (uuidv7-decoded, table in 1.1). 08-29: wave 1 12:57:10Z (136 ms spread), wave 2 13:05:56Z |
| Route anomaly | **none**: constant route. The 08-29 `token=` empty + cwd-FIFO fallback is a harness defect, not route variance; the 08-10 arms' instantaneous `connection closed` (1–2 lines after registration) is the migration, not a route deviation |

---

## 2.1 Hypothesis verdicts

| hypothesis | verdict | killed/kept by (citation) |
|---|---|---|
| **H-dual-load** — repo loads the bridge twice; a surviving connection keeps it reachable | **DEAD** | P2 instrumentation: `initBridge` exactly once in both sources, `prevGen=0`; `disconnect()` never called in the failing arm (transcript 08-10 23:57:54). Exactly one registration per sid per wave in server.log (1.4 table). Re-registration is not repo-correlated (01a04d06 3×; controls' re-regs are reconnect/restart recoveries). |
| **H-resolution-path** — per-arm resolution behavior from extension code vintage | **ALIVE after forensics — DEMOTED by the flip replay (Part 2)** | Repo cwd loads the bridge from working-tree TS (`package.json` `pi.extensions`, loaded per spawn — transcript 08-10 23:56:14); every other cwd loads the bundled/published build. At the 08-10 vintage (48e9c64d7) the working-tree source has **no mid-session migration path** (`discoverDashboard` imported, zero call sites in bridge.ts — 1.3). **BUT** the retarget decision code (`server-auto-start.ts` + the `.then()` `updateUrl` block) is byte-identical across both vintages, and under full parity both sources die at equal rates (7 boots each: 3/7 vs 4/7 died) — load source does not protect. Demoted per D6. |
| **H-config** — a third cwd-local config surface altering discovery | **FOLDS into H-resolution-path** | No third surface survives scrutiny: w-b had `openspec/` and migrated; pi-chainlint had `.pi/` **and** `openspec/` and migrated (08-10 matrix). Main repo `.pi/settings.json` declares no extension/discovery keys (only a skills path). The one repo-unique discovery-relevant surface is the `pi.extensions` load declaration — already the mechanism H-resolution-path owns (design D5 folds it). |
| **H-timing** — spawn racing the stale advertisement | **DEAD** (for immunity) | The rogue dashboards advertised continuously for ~22–23 h (08-10 22:18), so every arm had the same exposure window; timing cannot produce **hours** of immunity incl. a server restart (controls 019fee07/28/5d re-registered and stayed reachable while arms spawned minutes earlier/later died in seconds). Residual timing nuance — quick repo controls also lost their bridges eventually (1.1) — is noted but does not discriminate. |

Composite candidate: none beyond the surviving single factor set (load-source vintage);
per D6 the composite would count as one candidate anyway.

## 2.2 Go/no-go on the isolated replay (groups 3–4)

**GO — flip-focused scope (the "flip-only" branch of the 2.2 rule), not a full 7-arm replay.**

Rationale: the static evidence has already killed H-dual-load, H-config, and H-timing, and
has narrowed H-resolution-path to a single binary question the log cannot answer:
**did the pi-bundled extension build contemporaneous with 48e9c64d7 contain the
mid-session migration path?** That is settled by the designed instrument at minimum cost:

- Pin a worktree at **48e9c64d7** (guard absence confirmed in 1.3 — the parent's
  `ConnectionManager` re-target test does not exist there), stage the poisoned-discovery
  environment per design D4 / task 3.2, with `keeperLog.capturePiOutput=true`.
- Discriminating pair only: repo arm as-is (predict: immune) vs one `/tmp` arm (predict:
  migrates). No second vintage end is required — the 1.3 drift list shows the working-tree
  vintage was constant across the window; the open variable is the bundled build, which
  the harness must load from the pi install contemporary to the pin (if none can be
  staged, record the bounded negative result per D7 instead).
- Then the D6 flips, which are the actual confirmation: **4.1** remove the
  `pi.extensions` declaration from the pinned worktree's repo arm → predict: migrates;
  **4.2** add the declaration (pointing at the same pinned vintage) to the `/tmp` arm →
  predict: immune. Both directions on the same arm pair, ≥1 run each; if inconsistent,
  escalate to 4.3 repeats.

Groups 3–4 tasks execute exactly this scope; anything broader (full seven-arm × vintage
matrix) is not needed by the 2.2 rule and is explicitly not planned.

---

### Caveats / residual unknowns

1. Quick repo controls (019fee05, 019fee17-cb38, 019fee1c-00cb) show the same
   close+timeout epilogue as arms after their successful prompt — kill-vs-migration is not
   distinguishable for them; the durable immunity evidence is the three long-lived
   re-registering sessions.
2. The "01:52" second control is transcript-evidenced only (beyond extracted log range).
3. In-window commits' file-level diff not audited (subjects indicate no extension churn).
4. 08-10 spawn-mode token confirmation impossible (older log format); established from
   transcript instead.

---

# Part 2 — Isolated replay (groups 3–4, executed 2026-08-31)

## Environment (task 3.1–3.2)

- **Pinned worktree** at 48e9c64d7; guard absence confirmed (no `retarget`/
  `endpoint-resolution` in `packages/extension/src`, no `connection-migration.test.ts`).
  Removed again at 5.4.
- **Isolation**: docker compose override (lived in `/tmp`, never in the repo) baking the
  pinned source; service `s1` = pinned dashboard on 18000/18999 (published to host
  loopback only); **poison advertiser = a second pinned dashboard inside the same
  container/network namespace** on 8000/9999, loopback-bound — mirroring the original
  same-host rogues (advertised name resolves, dial refused). `PI_KEEPER_CAPTURE_PI_OUTPUT=1`.
- **Load-surface parity**: the 08-10 global surface reproduced by installing
  `@blackbelt-technology/pi-dashboard-extension@0.7.0` (published 07-24) into the
  container's pi npm prefix; arms with no local declaration load it; the repo arm
  (cwd `/repo`, the pinned tree mounted) loads the working tree via `pi.extensions`.
- **Containment verified both directions**: host `dns-sd -B` for 12 s saw only the
  user's own dashboards (no 18000/28000); in-network browse saw both advertisers with
  `isLocal: true`. Post-run: **0 replay-cwd sessions on the live dashboard** (abort
  criterion never approached).
- **Race instrumented**: 6 × `discoverDashboard(2000)` rounds → first-local was the
  poison 4/6 (s1 2/6) — the boot decision is a genuine coin-flip weighted by advertiser
  count/response order.

## Per-arm outcome table (task 3.3)

14 boots across both load sources, identical environment:

| arm | load source | boots | died (registered → connection closed ≤ s, never returned) | kept |
|---|---|---|---|---|
| canary ×6 (+1 pilot) | published 0.7.0 (global prefix) | 7 | 3 | 4 |
| repo arm ×6 (+1 pilot) | pinned working tree (`/repo` via `pi.extensions`) | 7 | 4 | 3 |

Every death = the original signature: `session registered` → `connection closed` within
seconds → (container-lifetime too short for the grace timeout). Every survivor stayed
connected for the observation window with heartbeats. Example: `wedge-r1` registered
`01a0569b-7043` → `connection closed` two lines later; `wedge-r2` registered → stable.

## Divergence point (task 3.4)

There is **no per-source divergence**: `server-auto-start.ts` and the `.then()`
`updateUrl` block are byte-identical between 0.7.0 and 48e9c64d7 (verified by diff).
The diverging instant is inside `autoStartServer`:

```ts
const servers = await deps.discoverDashboard(2000);
const local = servers.find(s => s.isLocal);
if (local) return { server: { host: local.host, port: local.port, piPort: local.piPort } };
```

— first-local wins; the bridge then applies `connection.updateUrl(ws://host:piPort)`
when the resolved `piPort ≠ config.piPort`. Resolve the poison → reconnect to its
loopback-only gateway → refused → silent death. Resolve s1 → ports match → keep.

## Flips (tasks 4.1–4.3) — both demote the candidate

- **Flip A (remove the candidate from the repo arm)**: nothing to remove — the repo arm
  carries no protection and died 4/7 without any removal.
- **Flip B (add the candidate to a /tmp arm)**: the candidate (working-tree load source)
  added via cwd `/repo`; died 4/7 — identical to 0.7.0 arms.
- **4.3 repeats**: 7 boots per arm type, no significant difference (3/7 vs 4/7). The
  outcome is boot-race chance, not load source.

## Revised conclusion

The mechanism that killed the original arms is confirmed and reproduced: **boot-time
mDNS retarget race** (identical logic in every load source). The original night's
"cwd asymmetry" is fully explained without any cwd mechanism:

1. **Majority outcome**: 3 rogue dashboards advertised vs 1 live server → per-boot death
   probability ≈ 0.75 → 8/8 arms dying is unremarkable (p ≈ 0.1).
2. **Prompt-delivery-before-death**: quick repo controls (23:33/23:52/23:57) also died
   server-side but their prompts landed first — scored "✅ works" by the probe method.
3. **Survivorship bias**: the only sessions observed keeping bridges for hours were the
   ones whose boot race happened to resolve the live server; they then re-registered
   through reconnects/restarts, compounding the impression of immunity.

**No live defect beyond the already-fixed hijack**: #569's guard makes an unreachable
candidate never adopted. Residual hardening candidate (not filed — behaviour is already
correct post-fix): the boot-time `updateUrl` retarget is still the riskiest line in the
bridge and could be dropped entirely once the spawn pin is trusted everywhere.

## Teardown (task 5.4)

Compose stack `down -v`, image deleted, pinned worktree removed (`git worktree list`
clean), zero `pi-replay` containers, live dashboard leak check 0. The compose override
never existed inside the repo. Scope audit (5.5): branch diff touches only
`openspec/changes/investigate-bridge-cwd-asymmetric-immunity/**`.
