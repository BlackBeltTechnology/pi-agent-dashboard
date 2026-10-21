# Test Plan — mirror-dashboard-trust-live-remote

Stage: design   Generated: 2026-10-21

Hard gate passed. Two answers were folded into the specs:
- the deadline slack is 100 ms (bridge-extension delta: "budget plus 100 ms");
- the remote digest target is p95 < 200 ms per side for 200 files / 2 MiB (pi-trust-mirror delta).

All other thresholds come straight from the specs:
- timeouts 300 / 1000 ms, clamped 50–1000;
- rate limits 20 / 200 per 10 s;
- proof permits 4 global / 1 per device;
- caps 1,000 files / 16 MiB;
- body 8 KiB, cwd 4,096 characters.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | settings › `liveQueryTimeoutMs` | EP+BVA | L1 | automated | `liveQueryTimeoutMs` ∈ {unset, 49, 50, 1000, 1001, 5000, -1, NaN, Infinity, "300"}; bridge kind ∈ {local, remote} | `parsePiTrustMirror` + effective-timeout resolver | unset→300 local / 1000 remote; 49→50; 50→50; 1000→1000; 1001→1000; 5000→1000; -1→50; NaN/Infinity/"300"→default; `liveQuery` default true; `sources.yolo` default true |
| E2 | snapshot › `liveCount` | EP | L1 | automated | snapshot JSON with `liveCount` ∈ {missing, -1, 1.5, "2", 0, 3}; a parent-era snapshot | `readPiTrustMirrorSnapshot` | missing/-1/1.5/"2" → 0; 0→0; 3→3; parent-era snapshot reads `liveCount` 0 and its entries unchanged |
| E3 | live sources › YOLO | decision-table | L1 | automated | YOLO ∈ {scoped live, scoped expired, ended, unscoped, env}; `sources.yolo` ∈ {t,f}; root ∈ {`/w`, `~/Downloads/x`} | live-entry provider enumerate | counted only for (scoped live ∨ env) ∧ yolo=true ∧ root not denied; unscoped never; denied root never |
| E4 | live sources › session worktree trust | state-transition | L1 | automated | session trust for `/tmp/r` (hash H1) | provider enumerate, then hook edited to H2 | entry keyed `/private/tmp/r` (translated) counts at H1; after H2 it is ignored `hook-changed` |
| E5 | live sources › session access grant | decision-table | L1 | automated | session grant on {project root, non-root}; choice ∈ {unset, true, false}; `accessGrants` default off | provider enumerate | counted only for project root ∧ choice=true; non-root → `not-project-root`; unset → `source-off` |
| E6 | snapshot › live count transitions | state-transition | L1 | automated | empty server | session grant add→revoke; worktree session add→revoke; YOLO activate→addRoot→end; YOLO expiry timer fires | `liveCount` 0→1→0, 0→1→0, 0→1→2→0, 1→0 on expiry with no denial; each rewrite lands before the action resolves; the file holds no live path, dev or ino |
| E7 | settings › session-scope choice in memory | state-transition | L1 | automated | "until dashboard restarts" with choice `false` | record; then simulated restart | no file under `~/.pi/dashboard` contains the choice; the live query does not cover the repo; after restart, neither entry nor choice exists |
| E8 | bridge › bounded live query (when to ask) | decision-table | L1 | automated | `enabled`, `liveQuery`, session kind × `coverInteractive`, recorded pi entry, denied cwd, snapshot result ∈ {cover, identity-mismatch, none}, `liveCount` ∈ {0,1}, remote ∈ {t,f} | `decideBridgeProjectTrust` with fake `liveQuery` | query issued iff enabled ∧ liveQuery ∧ allowed session ∧ no recorded entry ∧ not denied ∧ snapshot no cover ∧ (liveCount>0 ∨ remote); a snapshot cover never queries |
| E9 | bridge › outcome mapping | decision-table | L1 | automated | fake responses: ECONNREFUSED, 401, 403, 404, 429, `{covered:false}`, 500, malformed JSON, 302, covered with missing proof | handler | undecided with `live-unreachable`, `live-refused`×2, `live-unsupported`, `live-rate-limited`, `live-not-covered`, `live-error`×4; redirect not followed |
| E10 | bridge › stale instance | state-transition | L1 | automated | covered answer that holds proof | `inst.isActive()` flips false while the query is pending | handler resolves `{trusted:"undecided"}` |
| E11 | server › authentication | decision-table | L1 | automated | requests: none; raw legacy `X-Pi-Local-Token`; login cookie only; loopback + `X-Forwarded-For` + verified proof; loopback + verified proof; device bearer at operate; device bearer below operate | `POST /api/pi-trust/query` (fastify inject) | refused (no trust fields in body) for the first four; answered for verified proof and operate bearer; 403 `insufficient_scope` below operate |
| E12 | server › validation | BVA | L1 | automated | body 8,192 B vs 8,193 B; cwd 4,096 vs 4,097 chars; cwd with NUL; `work/x`; `/w/link/app` where `/w/link`→`/w/real` | query | 8,193 → 413; 4,097, NUL, relative → 400 (never 500); symlinked cwd → `{covered:false}`; in-bound values answered |
| E13 | server › server-side switches | decision-table | L1 | automated | server `enabled` ∈ {t,f}, `liveQuery` ∈ {t,f}; cwd ∈ {covered, `~/.ssh/x`} | query | `{covered:false}` whenever either switch is false or the cwd is denied |
| E14 | local proof › recorded identity | state-transition | L1 | automated | temp dir `/r` trusted "until dashboard restarts"; YOLO root `/w` | bridge verifies the answer as-is; then delete + re-create `/r` and `/w` | first: trusted; after re-create: undecided `identity-mismatch` for both |
| E15 | remote proof › digest equality | EP | L1 | automated | two copies of a tree (mtimes preserved) differing in: nothing; `.pi/mcp.json`; `<cwd>/.agents/skills/x.md`; `<parent>/.agents/skills/y.md`; `~/.agents/skills/z.md` | `trustResourceManifest` + HMAC on both | equal; differ; differ (k=0); differ (k=1); equal (user skills excluded) |
| E16 | remote proof › fail-closed set | BVA | L1 | automated | sets: empty; with a symlink; with a fifo; unparseable `settings.json`; `settings.json` with `packages`; extension path `../ext`; 1,000 vs 1,001 entries; 16 MiB vs 16 MiB + 1 B | manifest | `null` (`identity-weak`) for all except exactly 1,000 entries / exactly 16 MiB |
| E17 | remote proof › golden vs pi | EP | L1 | automated | installed pi `dist/core/trust-manager.js`; tree matrix (each resource name alone, ancestor skills, user skills only) | golden test | our name list = pi's array literal; our non-empty verdict = `hasTrustRequiringProjectResources` per tree; every path pi consults is in the manifest |
| E18 | remote proof › salt + cwd binding | EP | L1 | automated | same remote requester and covered cwd `/w/a`; second cwd `/w/b` with identical resources | two queries; replay the `/w/a` answer at `/w/b` | the two salts differ; the replayed answer fails `identity-mismatch` |
| E19 | remote proof › disclosure | EP | L1 | automated | paired-device covered answer | inspect body | keys are exactly `covered,salt,digest` — no `sourceKind`, `key`, `dev`, `ino` |
| E20 | rate limits + permits | BVA | L1 | automated | one device: 20 then 21 queries in 10 s; local: 200 then 201; 2 concurrent remote digests from one device; 5 from five devices | query burst | 21st device → 429; 201st local → 429; 2nd concurrent same-device digest → 429; 5th global digest → 429; one log line per window |
| E21 | rate limits › local identity takes no permit | EP | L1 | automated | 30 concurrent local queries with a live entry covering all | burst | 0 refused; 0 semaphore permits taken |
| E22 | observability › budget miss per class | BVA | L1 | automated | injected clock; local handling 350 ms (budget 300); remote handling 500 ms (budget 1000) | query | `budgetMissed` +1 for local; +0 for remote; counters exposed under `/api/health` `piTrustMirror.live` |
| E23 | decision order › server consumer | EP | L1 | automated | `/r` has `.pi/mcp.json`, nothing recorded, trusted "until dashboard restarts" only | `host.isProjectTrusted('/r')` / `projectTrustSource` | true, with source "worktree-init (until dashboard restarts)" |
| E24 | live sources › YOLO liveness re-check | state-transition | L1 | automated | YOLO root `/w` expiring at T; fake clock crosses T between cover lookup and proof build | query | `{covered:false}` |
| E25 | shared loopback predicate | EP | L1 | automated | hosts `127.0.0.1`, `127.0.0.2`, `::1`, `localhost`, `10.0.0.5`, `[::ffff:127.0.0.1]` | bridge `isRemoteBridge` + server admission | all loopback forms are local on both sides; `10.0.0.5` remote; the two sides never disagree |
| E26 | route registration | EP | L1 | automated | route table | `http-road-classification` totality test + `ROUTE_TIERS` lookup | `POST /api/pi-trust/query` classified like `/api/ws-ticket`; tier `operate` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | remote proof › digest budget | tail-latency | L1 | automated | trust-requiring tree of 200 files, 2 MiB, local temp disk | `trustResourceManifest`+HMAC p95 < 200 ms | 50 runs |
| P2 | bridge-extension › budget + 100 ms | tail-latency | L1 | automated | live server that accepts and never answers; `liveQueryTimeoutMs` 300 | handler resolves ≤ 400 ms, every run | 20 runs |
| P3 | bridge › snapshot step unchanged | tail-latency | L1 | automated | snapshot 1,000 entries, cwd 20 deep, snapshot miss, `liveCount` 0 | snapshot part p95 < 20 ms (parent test stays green) | 100 runs |
| P4 | bridge › deadline covers proof | tail-latency | L1 | automated | answer arrives at 250 ms; bridge walker stubbed slow (each read 50 ms) | handler resolves ≤ 400 ms with `live-timeout`; no open sockets or pending fs handles after resolve | 20 runs |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Access page › live list | EP | L1 | automated | API payload: YOLO `/w` until 14:30; worktree `/r` until restart; env YOLO `/e` | render `PiTrustMirrorSection` | rows `/w` "YOLO until 14:30", `/r` "until dashboard restarts", `/e` "YOLO while the server runs"; `liveQuery` + `liveQueryTimeoutMs` controls present; the code legend lists all 18 bridge reason codes |
| F2 | settings › checkbox on session-scope surfaces | decision-table | L1 | automated | `sources.worktreeInit` ∈ {t,f}; session grant creation with `accessGrants` off | open "Trust until dashboard restarts" / create session grant | checkbox checked iff `worktreeInit`; unchecked for the session grant; the submitted body carries `piTrust` |
| F3 | settings › YOLO disclosure | decision-table | L1 | automated | `sources.yolo` ∈ {t,f} | render `YoloActivation` | disclosure "also trusted in pi until YOLO ends" present iff true |
| F4 | MCP folder page › live lifetime | EP | L1 | automated | folder `/r` trusted "until dashboard restarts" only, nothing recorded | render folder MCP trust line | text names worktree-init trust for `/r` "until the dashboard restarts"; no "not trusted" notice |
| F5 | Access page › live row converges | state-convergence | L3 | automated | docker harness; YOLO activated on root `/workspace/a` | activate, then end YOLO | Access effective list gains the `/workspace/a` YOLO row, then loses it, without a reload; no duplicate rows at any point |
| F6 | end-to-end › session trust reaches pi | state-transition | L3 | automated | harness repo with `.pi/settings.json`; worktree-init "Trust until dashboard restarts" | spawn a headless session in a new worktree of it | session reports project resources loaded (trusted); after a dashboard restart, a new spawn there is not trusted through it |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | bridge › server stopped | fault-injection (abort) | L1 | automated | `liveCount` 1 in the snapshot; nothing listens on the port | project_trust | undecided within 400 ms; log `live-unreachable` |
| X2 | bridge › server slow | fault-injection (delay) | L1 | automated | server delays 2 s | project_trust | undecided ≤ 400 ms, `live-timeout`; the server sees its request aborted |
| X3 | bridge › old server | fault-injection (abort) | L1 | automated | server answers 404 | project_trust | undecided, `live-unsupported` |
| X4 | snapshot › rewrite failure | fault-injection (abort) | L1 | automated | snapshot dir read-only | create a session grant | grant succeeds; one warning logged; `liveCount` on disk unchanged |
| X5 | snapshot › crash recovery | fault-injection (abort) | L1 | automated | snapshot on disk with `liveCount` 3 | server boot | snapshot rewritten with `liveCount` 0 before the gateway accepts bridges |
| X6 | content race | fault-injection (delay) | L1 | automated | server hashes, then a file under `.pi/extensions` changes, then the bridge hashes | remote verification | undecided, `identity-mismatch` |
| X7 | log sanitization | fault-injection (input) | L1 | automated | 25 queries with cwd `"/w/\n[ok] \u001b[2Jx"` | rate-limit log line | logged cwd has no `\n` or ESC; exactly one line per window |
| X8 | integration › local live path | fault-injection (abort) | L1 | automated | real server + bridge decision, temp HOME | trust `/r` "until dashboard restarts"; decide `/r/wt`; restart server; decide again | first: trusted; after restart: snapshot `liveCount` 0, no query issued, undecided |
| X9 | integration › remote path over loopback-as-remote | fault-injection (abort) | L1 | automated | server + bridge configured remote (device token, non-loopback alias), same temp tree | decide covered cwd; then edit `.pi/mcp.json` on the "bridge" copy | first: trusted via digest; after edit: undecided `identity-mismatch` |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | remote proof › real NFS across two hosts | exploratory | — | manual-only | two physical machines sharing `/work/x` over NFS; paired device | start pi on host B in `/work/x` while host A trusts it | [judgment: real-network latency and NFS attribute caching behave within budget — needs two hosts, no harness] |

---

## Coverage summary

- Requirements covered: 21/21. The delta requirements are the 8 MODIFIED pi-trust-mirror, 10 ADDED pi-trust-mirror, 1 MODIFIED bridge-extension, 1 MODIFIED mcp-client-folder-section, plus the unchanged parent requirements checked via P3.
- Scenarios by class: edge 26 · perf 4 · frontend 6 · error 9 · manual 1
- Scenarios by level: L1 43 · L3 2 · — 1
- Scenarios by disposition: automated 45 · manual-only 1

## New infra needed

- None. L1 uses vitest with temp dirs and fastify inject. L3 extends the existing docker harness specs (`tests/e2e/pi-trust-mirror.spec.ts`, `tests/e2e/project-trust-headless-spawn.spec.ts`).
