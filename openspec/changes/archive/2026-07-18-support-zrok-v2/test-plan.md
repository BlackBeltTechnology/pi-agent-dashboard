# Test Plan — support-zrok-v2

Stage: design   Generated: 2026-07-18

All Triples are concrete; no clarification gate is open (the spec was hardened
across three doubt-review cycles). Live-zrok-account-dependent scenarios route to
`manual-only` (CI has no enrolled v2 account); the pure logic they wrap (buildArgs,
routing, config, regex, version parse) routes to `L1`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Zrok binary detection | decision-table | L1 | automated | resolver finds only `zrok2` | `detectZrokBinary()` / `getZrokBinary()` | available=true, chosen binary = `zrok2` |
| E2 | Zrok binary detection | decision-table | L1 | automated | resolver finds only `zrok` (Homebrew/v1) | `getZrokBinary()` | available=true, chosen binary = `zrok` |
| E3 | Zrok binary detection | decision-table | L1 | automated | resolver finds neither | `detectZrokBinary()` | available=false; version check reports unavailable, no spawn |
| E4 | buildArgs ephemeral | EP | L1 | automated | no reservedName, port=8000 | `buildArgs(8000, undefined)` | `["share","public","--headless","localhost:8000"]` (flags-first) |
| E5 | buildArgs reserved | EP | L1 | automated | reservedName="myapp", port=8000 | `buildArgs(8000,"myapp")` | `["share","public","--headless","-n","public:myapp","localhost:8000"]` |
| E6 | Token validator lower bound | BVA | L1 | automated | 12-char token `RX1EuRvs9H8s` | `re.zrokToken.test` | accepted (min is now 8) |
| E7 | Token validator lower bound | BVA | L1 | automated | 7-char token | validator | rejected (below min 8) |
| E8 | Token validator upper/charset | BVA | L1 | automated | 201-char token, and a token containing `&` | validator | both rejected (max 200, no cmd.exe metachars) |
| E9 | Version compat | EP | L1 | automated | `zrok version` → `v2.0.4` | version check | status `ok` |
| E10 | Version compat | EP | L1 | automated | `zrok version` → `v0.4.51` (pre-2.0.0) | version check | status `warn` + upgrade remedy naming api-v1 500 |
| E11 | Version compat | EP | L1 | automated | `zrok version` → `2.0.0-rc.1` | version check | status `ok` (pre-release of GA major) |
| E12 | Version compat | EP | L1 | automated | `zrok version` → unparseable garbage | version check | status `warn` (unknown), no throw |
| E13 | urlRegex + normalize | BVA | L1 | automated | stdout `abc.shares.zrok.io` (bare) | match + normalizeUrl | `https://abc.shares.zrok.io` |
| E14 | urlRegex back-compat | BVA | L1 | automated | stdout `https://abc.share.zrok.io` (v1 singular, schemed) | match | returned unchanged |
| E15 | urlRegex anchor (spoof) | BVA | L1 | automated | stdout `foo.shares.zrok.io.attacker.com/x` | match as a `*.shares.zrok.io` host | NOT matched as a zrok host |
| E16 | CORS allow-list | decision-table | L1 | automated | Origin `https://x.shares.zrok.io` | `isCorsOriginAllowed` | allowed |
| E17 | CORS allow-list (spoof) | decision-table | L1 | automated | Origin `https://foo.shares.zrok.io.attacker.com` | `isCorsOriginAllowed` | denied |
| E18 | Install guide OS routing | decision-table | L1 | automated | serverOs ∈ {darwin,linux,win32,unknown} | render `/tunnel-setup` copy | darwin→`brew install zrok`; linux→pkg-repo/`zrok2`; win32→`zrok2` on PATH; unknown→linux+docs note |
| E19 | Config migration | decision-table | L1 | automated | `{tunnel:{reservedToken:"v1tok"}}` no provider | `normalizeTunnelConfig` | `{provider:"zrok",mode:"public"}`; `reservedToken` preserved; NOT promoted to `reservedName`; idempotent |
| E20 | Config schema defaults | EP | L1 | automated | fresh config | read `tunnel.zrok` | `persistent` default false, `reservedName` unset |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Install guide view | state-transition | L3 | automated | server reports `serverOs:"linux"` | open `/tunnel-setup` | guide shows Install/Enroll(`zrok enable <token>`)/Verify + docs.zrok.io link, package-repo commands |
| F2 | Tunnel status reflects active URL | state-convergence | L3 | automated | tunnel-status returns active `*.shares.zrok.io` | sidebar tunnel button | converges to connected indicator with the copyable v2 URL |
| F3 | Forget reserved control | state-transition | L3 | automated | active reserved tunnel | click "Forget reserved URL" | fires `POST /api/tunnel-disconnect {forget:true}`; button returns to disconnected state |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Share creation fails | fault-injection (abort) | L1 | automated | spawned share exits non-zero before URL | `createTunnel` | returns null; status inactive; no throw |
| X2 | Subprocess spawn timeout | fault-injection (delay) | L1 | automated | share process emits no URL for 30s | `createInner` timeout | process killed, warn logged, returns null |
| X3 | Orphan scavenge matches zrok2 | state-transition | L1 | automated | ps line `<abs>/zrok2 share public --headless localhost:8000` | scavenge with `/\bzrok2? share\b/` | matched + killed; an unrelated `localhost:8000` line NOT matched; a `zrok share` v1 line matched |
| X4 | Reserved retry no-recycle | fault-injection (abort) | L1 | automated | caller-provided reserved name, share exits once | core crash-exit retry | `!callerProvidedToken` guard → no `release`/`delete name`; SAME name re-served |
| X5 | Ephemeral no auto-mint | state-transition | L1 | automated | connect with `persistent=false` | provider `connect` | never calls `zrok2 create name`; ephemeral share only |
| X6 | Legacy token not served as name | decision-table | L1 | automated | config has stray `reservedToken`, no `reservedName` | connect | ephemeral share; args are NOT `-n public:<v1tok>` |
| X7 | reservedName survives partial write | state-transition | L1 | automated | config with `zrok.reservedName` set | `writeConfigPartial({tunnel:{enabled:false}})` | `reservedName` + `persistent` still present after merge |
| X8 | api-v2 reachability | fault-injection (delay/abort) | L1 | automated | DNS lookup of `api-v2.zrok.io` fails | doctor "zrok API reachable" | failure row + network/DNS suggestion; no api-v1 in text |
| X9 | api endpoint from enrolled env | decision-table | L1 | automated | enrolled env `api_endpoint` present | doctor api-reachable | probes the recorded endpoint, not the hosted default |
| X10 | Name taken by another account | fault-injection (abort) | L1 | automated | `create name` fails as taken-by-other | provider mint | warn logged; falls back to ephemeral; does NOT persist/rotate a name |

### Live-zrok / integration (manual-only — CI has no enrolled v2 account)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Headless enroll end-to-end | state-transition | — | manual-only | valid 12-char v2 token, no TTY | `zrok enable <token> --headless` server-side | enrolls without `/dev/tty` error; `zrok status` shows identity set |
| M2 | Ephemeral connect live | state-transition | — | manual-only | enrolled v2 host | `POST /api/tunnel-connect` (no persistent) | active `*.shares.zrok.io` URL serves the dashboard (200) |
| M3 | Persistent stable URL across restart | state-transition | — | manual-only | `tunnel.zrok.persistent=true` | connect → restart server → reconnect | SAME `<name>.shares.zrok.io` URL both times (survives restart) |
| M4 | Plain disconnect preserves name | state-transition | — | manual-only | active reserved tunnel | `POST /api/tunnel-disconnect` (no body) | share stops; `zrok list names` still shows the name; reconnect → same URL |
| M5 | Forget releases name | state-transition | — | manual-only | active reserved tunnel | `POST /api/tunnel-disconnect {forget:true}` | `zrok list names` no longer shows it; config `reservedName` cleared |
| M6 | Docker image ships zrok v2 | state-transition | L2 | automated | built docker image | `docker run … zrok2 version` and `zrok version` | both report v2.0.4 (symlink resolves) |
| M7 | Doctor all-green on v2 host | state-transition | — | manual-only | enrolled v2 host, tunnel active | run doctor | binary/env/api-v2/version-compat/tunnel-runtime all ok |

---

## Coverage summary

- Requirements covered: all SHALL/scenario blocks across the 5 spec deltas.
- Scenarios by class: edge 20 · perf 0 · frontend 3 · error 10 · live/integration 7.
- Scenarios by level: L1 30 · L2 1 (M6) · L3 3 · manual-only 6.
- Scenarios by disposition: automated 34 · manual-only 6.

## New infra needed

- none. L1 → vitest `packages/*/**/__tests__/`; L3 → `tests/e2e/*.spec.ts` vs the
  docker harness `.pi-test-harness.json` `dashboardPort` (never hardcode :18000);
  L2 → `qa/tests/*.sh` (M6 docker build/version smoke). Perf tier unused (this
  change has no latency/throughput budget).

## Notes

- **Why 0 perf scenarios:** the change introduces no latency/throughput/memory
  budget; the only time bound is the pre-existing 30s spawn timeout, covered as
  error-handling (X2), not a perf threshold.
- **Live-account rows (M1–M5, M7)** are `manual-only` because their observable
  requires a real enrolled v2 zrok account + public network — unavailable in CI.
  Their underlying logic is separately covered automated at L1 (buildArgs E4/E5,
  routing X4/X5/X6, config X7/E19, version E9–E12).
