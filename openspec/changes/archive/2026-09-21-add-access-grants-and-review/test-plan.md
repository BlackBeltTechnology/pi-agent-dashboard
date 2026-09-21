# Test Plan — add-access-grants-and-review

Stage: apply   Generated: 2026-08-20

## ✓ Clarifications resolved (5)

- [x] **C1** — Grant store cap → **fixed 200, oldest-evicted** (`design.md` D10). Unblocks E7.
- [x] **C2** — Grant-write failure → **not recorded; re-ask next request** (TOFU precedent), failure logged server-side, request never failed (`design.md` D11). Unblocks X4.
- [x] **C3** — Access tab grant creation → **review-and-revoke only**; grants originate solely from a denial remedy surface (`design.md` D12). Unblocks F5.
- [x] **C4** — Project-trust revoke → **through a pi API, identified first**; read-only fallback if none exists (`design.md` D13). Unblocks F6.
- [x] **C5** — Check→open TOCTOU → **closed via open-then-verify on the handle**, grant layer only (`design.md` D14). Unblocks X5.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Grant admits own subtree only | state-partition | L1 | automated | grant `/repo/sub`; `/repo` is a git repo with common root `/repo` | read `/repo/other/secret.txt`, outside every derived anchor | HTTP 403 `{success:false,error:"path outside working directory"}` — grant does NOT widen to git root |
| E2 | Grant admits own subtree only | EP (inside) | L1 | automated | grant `/a/b` | read `/a/b/deep/c.txt` | allowed (200) |
| E3 | Grant admits own subtree only | BVA (sibling boundary) | L1 | automated | grant `/a/b` | read `/a/bb/c.txt` (prefix-adjacent, NOT a subtree member) | 403 — separator-aware compare, not raw `startsWith` |
| E4 | Grant admits own subtree only | EP (parent) | L1 | automated | grant `/a/b` | read `/a/sibling` | 403 |
| E5 | Empty-store equivalence | EP (null case) | L1 | automated | grant store absent | run the full pre-existing `file-read-containment` suite | every outcome byte-identical to layers 1–2 alone; no status code or `error` string changes; only the 20 strict body assertions widen |
| E6 | `isAllowed` unchanged | regression | L1 | automated | grant store populated with `/other` | call `isAllowed(p,{anchors})` directly | return value identical to pre-change for every input; grants never reach this function |
| E7 | Grant store bounds | BVA | L1 | automated | store holding exactly 200 grants | a 201st grant recorded | size stays 200; oldest-by-grantedAt evicted; a read under the evicted subject returns 403 |
| E8 | Scope semantics | decision-table | L1 | automated | scope ∈ {session, project} × restart ∈ {yes, no} | evaluate grant after each combination | project+restart=in force; project+no-restart=in force; session+no-restart=in force; session+restart=NOT in force |
| E9 | Subject normalisation | EP | L1 | automated | grant requested for file path `/a/b/c.txt` | record the grant | persisted subject is `/a/b` |
| E10 | Ledger cap under queue role | BVA | L1 | automated | ledger holding 50 distinct IPs | denial from a 51st distinct IP | oldest-distinct evicted, size stays 50, no grant side effect |
| E11 | Anti-poisoning preserved | regression | L1 | automated | generalized ledger | run the pre-existing `network-denial-ring-buffer` suite | passes unchanged: socket-peer-only IP, dedupe by IP, oldest-distinct eviction, `trustable` classification |
| E12 | CORS origin capture | EP | L1 | automated | two CORS refusals, same peer IP, different origins | record both | one entry keyed by IP (dedupe intact), refused origin captured as an additional field |
| E13 | Denial body additivity | EP | L1 | automated | request refused at each of the 3 real WIRE shapes: `{success,error}`, bare `{error}` (kb `rejectCwd`), `{error,message}` (mcp-client) | inspect each body | pre-existing fields byte-identical; `reason`/`hint` added alongside. The gates' `{code,error}` is internal-only — see E25 |
| E14 | Path grant ≠ cwd pin | decision-table | L1 | automated | `/a/b` granted as path anchor, NOT pinned | request with `cwd=/a/b` | still 403 unknown-cwd — the two remedies are independent |
| E15 | Per-scope eviction | state-partition | L1 | automated | 200 persisted project grants | session grants recorded past the session bound | every project grant still present on disk — eviction never crosses scope |
| E16 | Grant binds to a recorded denial | decision-table | L1 | automated | grant requested for a directory no denial named | submit the grant | refused, nothing recorded |
| E17 | Forbidden subjects | BVA (dangerous boundary) | L1 | automated | a denial naming `/`, `$HOME`, `~/.ssh`, `~/.pi` | grant each | each refused, nothing recorded |
| E18 | Session grant is process-global | state-partition | L1 | automated | session-scoped grant created from session A's denial | session B reads under the subject | admitted — `"session"` means the server process, not the pi session |
| E19 | Session grant fully described | EP | L1 | automated | a session-scoped grant | list grants | carries subject, scope, `grantedAt`, origin — not a bare string key |
| E20 | Per-site rejection strings preserved | decision-table | L1 | automated | a refusal at each of the 8 body-emitting containment sites | inspect each `error` | `exists` keeps `"unknown cwd"`/`"path outside cwd"`; `session-routes` keeps `"path outside session directory"`; the rest keep `"path outside working directory"` |
| E22 | Denial registry records the subject | EP | L1 | automated | a containment denial at a body-emitting site | inspect the registry and the response | entry carries subject + identifier + site + session + timestamp; body carries identifier and subject beside an unchanged `error` |
| E23 | Registry expiry and cap | BVA | L1 | automated | registry at its cap, plus one expired entry | record a further denial; then grant against the expired id | oldest evicted, size stays at cap; the expired id is refused |
| E24 | Session-directory site admits grants | EP | L1 | automated | a grant covering a path outside the session directory | read it via the `session-routes.ts` site | admitted; without the grant the string `"path outside session directory"` is unchanged |
| E26 | Newly-censused cwd sites enriched | EP | L1 | automated | a refusal at `mcp-client-plugin/src/server/routes.ts:131,:163` and at the goal-plugin `rejectInvalidCwd` sites | inspect each body | `reason`/`hint` added; pre-existing `error` and `message` byte-identical |
| E25 | Gate wire shape unchanged | regression | L1 | automated | a refusal at `gateFilePath` and `gateOfficeFile` | inspect the wire body | `{ success: false, error }` with the same status — the internal `{ code, error }` never reaches the wire |
| E21 | Artifact-root admission runs first | state-partition | L1 | automated | an image under an artifact root, empty grant store | request it at `GET /api/file/raw` | admitted exactly as before, grant layer never consulted |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Grant check on the hot path | threshold | L1 | automated | 1000 reads that hit layer 1 (inside `cwd`), grant store holding 50 entries | added latency vs pre-change p95 ≈ 0 — layer 3 must not execute when layer 1 hits; assert zero `realpath` calls attributable to the grant check | single run |
| P2 | Grant check on the cold path | tail-latency | L1 | automated | 200 containment misses, grant store holding 50 entries | p95 of the grant check < 50ms (bounded by 50 `realpath` syscalls) | single run |
| P3 | Suite runtime unaffected | threshold | L1 | automated | full `npm test` before and after the change | total runtime within noise (±5%) | 3 runs each |
| P4 | Empty store costs zero syscalls | invariant | L1 | automated | empty grant store, a containment miss | zero filesystem syscalls attributable to the grant layer; zero synchronous reads on the containment path | single run |
| P5 | Grep amplification bounded | tail-latency | L1 | automated | 500 grep matches, 200 grants stored | store read from memory — at most one store load across the whole request | single run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Access tab lists every in-scope store | state-convergence | L3 | automated | fixtures seeded in all 8 stores | open `Settings → Access` | converges to a list containing ≥1 entry from each of the 8 stores, each labelled with its origin store |
| F2 | bypassHosts distinguishable | decision-table | L3 | automated | a host in `auth.bypassHosts` and a CIDR in `config.trustedNetworks` | open the Access tab | the two render as separate entries with distinct store labels; revoking one leaves the other |
| F3 | Empty state | EP (null) | L3 | automated | every store empty | open the Access tab | empty state rendered, no error boundary, no console error |
| F4 | Revoke takes effect without restart | state-transition | L3 | automated | `/other/repo` granted; a read under it returns 200 | revoke via the Access tab, then repeat the read | converges to 403 with no server restart |
| F5 | No grant creation from the tab | invariant | L3 | automated | Access tab open with entries from every store | scan the rendered surface for an add/create control | no control creates a grant for an arbitrary subject; the only write action per entry is revoke |
| F6 | Project-trust revoke | state-transition | L3 | automated | a project-trust entry exists | revoke from the Access tab | if a pi revoke API exists, revocation goes through it and the dashboard never writes pi's store; if not, the entry renders read-only marked managed-by-pi |
| F7 | Legacy KB entry renders | EP (legacy data) | L3 | automated | `kb-source-trust.json` holding a pre-change hash-only entry | open the Access tab | entry renders as an opaque hash with a working revoke; no error |
| F8 | Reading the tab writes nothing | invariant | L1 | automated | all 8 store files, hashed before render | render the Access tab | every store file's hash unchanged after render |
| F9 | Accept suppressed for non-trustable | decision-table | L3 | automated | ledger entries: one loopback, one proxy-terminated, one genuine remote | open the pending-access-request surface | accept action offered ONLY for the genuine remote entry |
| F10 | Session grants listed like persisted ones | EP | L3 | automated | a session-scoped path grant in effect | open the Access tab | listed with subject, scope, grant time, origin and a working revoke |
| F11 | Project-trust revoke deletes | state-transition | L3 | automated | a project-trust entry exists | revoke it from the tab | routed through the existing `persistTrustDecision` wrapper; entry absent afterwards; no standing negative decision recorded |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Malformed store degrades | fault-injection (corrupt data) | L1 | automated | `access-grants.json` containing `{not json` | any containment check | treated as zero grants; containment falls back to layers 1–2; no throw, no 500 |
| X2 | Symlink escape refused | fault-injection (path) | L1 | automated | `/a/b` granted, containing symlink `esc → /etc` | read `/a/b/esc/passwd` | 403 — grant check compares real paths |
| X3 | Symlink retarget does not move the grant | state-transition (illegal edge) | L1 | automated | `/wt/current → /wt/v1`, granted while pointing at v1 | repoint `/wt/current → /wt/v2`, read under `/wt/v2` | 403 — grant bound to `/wt/v1`, the directory the operator approved |
| X4 | Grant write failure | fault-injection (EIO) | L1 | automated | store write throws `EACCES` | operator grants `/a/b` | subject stays ungranted (next read 403s); failure logged; no unhandled rejection, no 500; request itself not failed |
| X5 | TOCTOU between check and open | fault-injection (race) | L1 | automated | granted dir; path replaced with a symlink to `/etc` between check and open | read racing the swap | refused — containment verified against the open handle, not a re-resolved path; an unswapped read is unaffected |
| X6 | realpath on a missing subject | fault-injection (ENOENT) | L1 | automated | granted directory deleted after the grant | read a path under the deleted subject | fails closed (403), no unhandled rejection, no 500 |
| X7 | Granted dir recreated as a symlink | fault-injection (substitution) | L1 | automated | granted `/a/b` deleted, recreated as symlink → `/etc` | read `/a/b/passwd` | 403 — stored real path no longer matches |
| X8 | Degraded git still fails closed | fault-injection (subprocess) | L1 | automated | `git` unavailable, grant store populated | read outside every anchor and every grant | 403; the grant check must not mask the degraded-git fail-closed behaviour |
| X9 | Ledger recording never disrupts the denial | fault-injection (throw) | L1 | automated | ledger `record()` throws | a guard denial occurs | error swallowed; the 403 is still sent |
| X10 | Accept path writes only through config | fault-injection (assertion) | L1 | automated | ledger holding a trustable pending entry | accept it | `trustedNetworks` mutated via the existing config write path only; the ledger itself never mutates policy |
| X11 | Non-HTTP denial sites untouched | regression | L1 | automated | `plugin_action` handlers (kb-plugin `:47`, apple-tools `:113`) and `visitor-session-registry:155` | trigger an unknown-cwd refusal at each | behaviour byte-identical to pre-change; no remedy fields, no crash |
| X12 | No unauthenticated write to the ledger | invariant | L1 | automated | full route inventory | scan for any endpoint that creates a pending access request | none exists; the ledger is written only by the guard |
| X13 | Interrupted grant write | fault-injection (crash) | L1 | automated | process interrupted mid-write | read the store back | either the previous contents or the complete new contents — never truncated, never an empty-degraded wipe of persisted grants |
| X14 | Non-regular file in a granted dir | fault-injection (FIFO) | L1 | automated | `/a/b` granted and containing a FIFO | read the FIFO | refused before any `open`; the request does not block |
| X16 | Handle verification is scoped to byte-serving sites | regression | L1 | automated | a grant covering a directory | list it via the tree site, probe it via `exists`, resolve a mention | each succeeds — the regular-file rule applies only to byte-serving reads and does not break directory admission |
| X17 | Forbidden subject via symlink | fault-injection (alias) | L1 | automated | a denial naming a path resolving to a system directory (`/etc` via `/private/etc`) | grant it | refused — comparison is against real paths |
| X18 | No inbound write to the denial registry | invariant | L1 | automated | full route inventory | scan for an endpoint creating a registry entry | none exists; the registry is written only by the denial path |
| X15 | Cross-origin / unauthenticated grant | fault-injection (origin) | L1 | automated | grant request from a disallowed origin, and one without authentication | submit each | both refused, nothing recorded |

---

## Coverage summary

- Requirements covered: 26/26 (0 rows carry clarification markers). Two cross-model doubt cycles added: grant-to-denial binding, session-scope semantics, per-scope eviction, handle-identity verification, and the path-denial registry that binding requires.
- Scenarios by class: edge 26 · perf 5 · frontend 11 · error 18
- Scenarios by level: L1 50 · L2 0 · L3 10 · manual-only 0
- Scenarios by disposition: automated 60 · manual-only 0

No `manual-only` rows: every requirement in this change has an automatable
observable. The subjective surface (how the Access tab *looks*) is not a
requirement here.

No L2 rows: this change adds no install, spawn, or multi-OS runtime behaviour —
it is server logic plus one settings page.

## New infra needed

None. L1 rows extend the existing `packages/server/src/**/__tests__/` vitest
suites (nearest exemplars: `path-containment` tests for E1–E6/X2–X8,
`network-denial-ring-buffer` tests for E10–E12/X9–X10). L3 rows extend
`tests/e2e/` against the docker harness, reading `dashboardPort` from
`.pi-test-harness.json` rather than a hardcoded port.
