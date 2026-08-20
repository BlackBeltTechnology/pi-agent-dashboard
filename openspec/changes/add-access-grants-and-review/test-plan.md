# Test Plan — add-access-grants-and-review

Stage: apply   Generated: 2026-08-20

## ⚠ Clarifications needed (5)

- [ ] **C1** — Grant store has no size cap anywhere in the spec (blocks E7). The denial ledger caps at 50 and pinned directories are user-curated, but `access-grants.json` grows unbounded, and every containment miss linearly scans it with a `realpath` per entry. Is the cap (a) none — accept unbounded growth, (b) a fixed count e.g. 200 with oldest-evicted, or (c) none but grants deduped by subtree containment on write (granting `/a` drops a redundant `/a/b`)?
- [ ] **C2** — Grant-write failure behaviour is listed as an open question in `design.md` and as "decide" in task 1.8 (blocks X4). When the store write fails after the operator grants, does the request (a) still succeed for this one read and surface a warning, (b) fail closed with an error naming the write failure, or (c) succeed silently and re-ask next time (the TOFU precedent)?
- [ ] **C3** — Whether `Settings → Access` can *create* a grant, not only revoke one, is an open question (blocks F5). Without a dialog this determines whether a filesystem grant can be created at all in this change. Is it (a) review-and-revoke only — grants only ever come from the denial remedy surface, (b) full add/edit/revoke, or (c) add restricted to directories that appear in a recent denial?
- [ ] **C4** — Revoking pi's `ProjectTrustStore` from the Access tab was never verified as feasible (blocks F6). `resource-toggle-trust.ts:114` exposes a read path; no revoke was confirmed. Is project trust (a) listed read-only with revoke deferred, (b) revoked through a pi API that needs identifying first, or (c) excluded from the tab like `paired-devices.json`?
- [ ] **C5** — TOCTOU window on the grant check has no stated requirement (blocks X5). `realpath` is resolved at check time, then the file is opened afterwards; a symlink swapped in between would be read despite the check. Is this (a) accepted as out of scope (matching layer 2, which has the same window today), or (b) required to be closed via an open-then-verify handle?

> Resolve before the blocked scenarios (marked below) can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Grant admits own subtree only | state-partition | L1 | automated | grant `/repo/sub`; `/repo` is a git repo with common root `/repo` | read `/repo/other/secret.txt`, outside every derived anchor | HTTP 403 `{success:false,error:"path outside working directory"}` — grant does NOT widen to git root |
| E2 | Grant admits own subtree only | EP (inside) | L1 | automated | grant `/a/b` | read `/a/b/deep/c.txt` | allowed (200) |
| E3 | Grant admits own subtree only | BVA (sibling boundary) | L1 | automated | grant `/a/b` | read `/a/bb/c.txt` (prefix-adjacent, NOT a subtree member) | 403 — separator-aware compare, not raw `startsWith` |
| E4 | Grant admits own subtree only | EP (parent) | L1 | automated | grant `/a/b` | read `/a/sibling` | 403 |
| E5 | Empty-store equivalence | EP (null case) | L1 | automated | grant store absent | run the full pre-existing `file-read-containment` suite | every outcome byte-identical to layers 1–2 alone; suite passes with zero edits |
| E6 | `isAllowed` unchanged | regression | L1 | automated | grant store populated with `/other` | call `isAllowed(p,{anchors})` directly | return value identical to pre-change for every input; grants never reach this function |
| E7 | Grant store bounds | BVA | L1 | automated | store at N grants | one more grant recorded | [NEEDS CLARIFICATION: input/observable — no cap is specified; see C1] |
| E8 | Scope semantics | decision-table | L1 | automated | scope ∈ {session, project} × restart ∈ {yes, no} | evaluate grant after each combination | project+restart=in force; project+no-restart=in force; session+no-restart=in force; session+restart=NOT in force |
| E9 | Subject normalisation | EP | L1 | automated | grant requested for file path `/a/b/c.txt` | record the grant | persisted subject is `/a/b` |
| E10 | Ledger cap under queue role | BVA | L1 | automated | ledger holding 50 distinct IPs | denial from a 51st distinct IP | oldest-distinct evicted, size stays 50, no grant side effect |
| E11 | Anti-poisoning preserved | regression | L1 | automated | generalized ledger | run the pre-existing `network-denial-ring-buffer` suite | passes unchanged: socket-peer-only IP, dedupe by IP, oldest-distinct eviction, `trustable` classification |
| E12 | CORS origin capture | EP | L1 | automated | two CORS refusals, same peer IP, different origins | record both | one entry keyed by IP (dedupe intact), refused origin captured as an additional field |
| E13 | Denial body additivity | EP | L1 | automated | request refused at each of the 3 body shapes (`{success,error}`, `{code,error}`, bare `{error}`) | inspect each body | pre-existing fields byte-identical; `reason`/`hint` added alongside |
| E14 | Path grant ≠ cwd pin | decision-table | L1 | automated | `/a/b` granted as path anchor, NOT pinned | request with `cwd=/a/b` | still 403 unknown-cwd — the two remedies are independent |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Grant check on the hot path | threshold | L1 | automated | 1000 reads that hit layer 1 (inside `cwd`), grant store holding 50 entries | added latency vs pre-change p95 ≈ 0 — layer 3 must not execute when layer 1 hits; assert zero `realpath` calls attributable to the grant check | single run |
| P2 | Grant check on the cold path | tail-latency | L1 | automated | 200 containment misses, grant store holding 50 entries | p95 of the grant check < 50ms (bounded by 50 `realpath` syscalls) | single run |
| P3 | Suite runtime unaffected | threshold | L1 | automated | full `npm test` before and after the change | total runtime within noise (±5%) | 3 runs each |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Access tab lists every in-scope store | state-convergence | L3 | automated | fixtures seeded in all 8 stores | open `Settings → Access` | converges to a list containing ≥1 entry from each of the 8 stores, each labelled with its origin store |
| F2 | bypassHosts distinguishable | decision-table | L3 | automated | a host in `auth.bypassHosts` and a CIDR in `config.trustedNetworks` | open the Access tab | the two render as separate entries with distinct store labels; revoking one leaves the other |
| F3 | Empty state | EP (null) | L3 | automated | every store empty | open the Access tab | empty state rendered, no error boundary, no console error |
| F4 | Revoke takes effect without restart | state-transition | L3 | automated | `/other/repo` granted; a read under it returns 200 | revoke via the Access tab, then repeat the read | converges to 403 with no server restart |
| F5 | Proactive grant creation | state-transition | L3 | automated | Access tab open | user attempts to add a grant | [NEEDS CLARIFICATION: trigger/observable — is add supported at all? see C3] |
| F6 | Project-trust revoke | state-transition | L3 | automated | a project-trust entry exists | revoke from the Access tab | [NEEDS CLARIFICATION: observable — revoke feasibility via pi's API unverified; see C4] |
| F7 | Legacy KB entry renders | EP (legacy data) | L3 | automated | `kb-source-trust.json` holding a pre-change hash-only entry | open the Access tab | entry renders as an opaque hash with a working revoke; no error |
| F8 | Reading the tab writes nothing | invariant | L1 | automated | all 8 store files, hashed before render | render the Access tab | every store file's hash unchanged after render |
| F9 | Accept suppressed for non-trustable | decision-table | L3 | automated | ledger entries: one loopback, one proxy-terminated, one genuine remote | open the pending-access-request surface | accept action offered ONLY for the genuine remote entry |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Malformed store degrades | fault-injection (corrupt data) | L1 | automated | `access-grants.json` containing `{not json` | any containment check | treated as zero grants; containment falls back to layers 1–2; no throw, no 500 |
| X2 | Symlink escape refused | fault-injection (path) | L1 | automated | `/a/b` granted, containing symlink `esc → /etc` | read `/a/b/esc/passwd` | 403 — grant check compares real paths |
| X3 | Symlink retarget does not move the grant | state-transition (illegal edge) | L1 | automated | `/wt/current → /wt/v1`, granted while pointing at v1 | repoint `/wt/current → /wt/v2`, read under `/wt/v2` | 403 — grant bound to `/wt/v1`, the directory the operator approved |
| X4 | Grant write failure | fault-injection (EIO) | L1 | automated | store write throws `EACCES` | operator grants a directory | [NEEDS CLARIFICATION: observable — see C2] |
| X5 | TOCTOU between check and open | fault-injection (race) | L1 | automated | granted dir; symlink swapped between check and open | read racing the swap | [NEEDS CLARIFICATION: observable — is the window in scope? see C5] |
| X6 | realpath on a missing subject | fault-injection (ENOENT) | L1 | automated | granted directory deleted after the grant | read a path under the deleted subject | fails closed (403), no unhandled rejection, no 500 |
| X7 | Granted dir recreated as a symlink | fault-injection (substitution) | L1 | automated | granted `/a/b` deleted, recreated as symlink → `/etc` | read `/a/b/passwd` | 403 — stored real path no longer matches |
| X8 | Degraded git still fails closed | fault-injection (subprocess) | L1 | automated | `git` unavailable, grant store populated | read outside every anchor and every grant | 403; the grant check must not mask the degraded-git fail-closed behaviour |
| X9 | Ledger recording never disrupts the denial | fault-injection (throw) | L1 | automated | ledger `record()` throws | a guard denial occurs | error swallowed; the 403 is still sent |
| X10 | Accept path writes only through config | fault-injection (assertion) | L1 | automated | ledger holding a trustable pending entry | accept it | `trustedNetworks` mutated via the existing config write path only; the ledger itself never mutates policy |
| X11 | Non-HTTP denial sites untouched | regression | L1 | automated | `plugin_action` handlers (kb-plugin `:48`, apple-tools `:169`) and `visitor-session-registry:155` | trigger an unknown-cwd refusal at each | behaviour byte-identical to pre-change; no remedy fields, no crash |
| X12 | No unauthenticated write to the ledger | invariant | L1 | automated | full route inventory | scan for any endpoint that creates a pending access request | none exists; the ledger is written only by the guard |

---

## Coverage summary

- Requirements covered: 24/24 (5 rows carry clarification markers)
- Scenarios by class: edge 14 · perf 3 · frontend 9 · error 12
- Scenarios by level: L1 27 · L2 0 · L3 8 · manual-only 0
- Scenarios by disposition: automated 38 · manual-only 0

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
