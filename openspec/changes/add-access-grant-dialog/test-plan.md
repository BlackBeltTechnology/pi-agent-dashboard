# Test Plan — add-access-grant-dialog

Stage: apply   Generated: 2026-09-18

## ⚠ Clarifications needed (5)

- [ ] **C1** — Prompt-volume constants (design D9 open question) block every
  threshold scenario (E20–E23, P2). Needed as numbers, not adjectives: the
  per-subject backoff window, the per-plane prompt ceiling and its period, the
  global concurrent-dialog cap, and the new per-channel share of registry
  capacity. Candidates to choose between: (a) backoff 60s / plane 10 per min /
  global 3 concurrent / per-channel 25% of capacity; (b) backoff 5 min / plane 3
  per min / global 1 concurrent / per-channel 10%. Without values, "one requester
  cannot exhaust the budget" has no boundary to test.
- [ ] **C2** — Pending-entry TTL and registry capacity (design D4) are unnamed.
  E10/E11/X6 need the exact expiry seconds and the exact entry ceiling to test
  just-below / at / just-above.
- [ ] **C3** — YOLO session durations. The mockup shows 15 min / 30 min / 1 hour /
  until-stopped; the spec names none. E30–E32 need the shipped set and whether
  "until I stop it" is unbounded or capped.
- [x] **C4** — ~~Remembered-`deny` lifetime.~~ **RESOLVED:** durable across
  restart, never self-expiring, cleared only by an explicit operator action on
  the Access surface (`access-grant-yolo`; `design.md` Migration Plan).
- [ ] **C5** — `Sec-Fetch-Site` accepted value set for capability issuance.
  `same-origin` only, or also `same-site` / `none` (a top-level navigation sends
  `none`)? E2/E3 partition on this, and getting it wrong either blocks the real
  dashboard or admits a cross-site caller.
- [ ] **C6** — Held-request suspension ceiling. `git-routes` restores
  `socket.timeout` after `setTimeout(0)`, but no maximum hold is specified. P1 and
  X2 need the cap and what the requester receives when it elapses.

> Resolve before the blocked scenarios (marked below) can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | eligibility · capability issued only to browser-shaped connections | decision-table | L1 | automated | WS upgrade with `Origin` absent, ticket valid | connection established | no capability issued; `grant_channel` frame never sent |
| E2 | eligibility · issuance signals | decision-table | L1 | automated | upgrade with non-absent admitted `Origin` + `Sec-Fetch-Site: same-origin` + valid credential tier | connection established | capability issued exactly once |
| E3 | eligibility · issuance signals | decision-table | L1 | automated | upgrade with admitted `Origin` but `Sec-Fetch-Site: cross-site` | connection established | [NEEDS CLARIFICATION: expected observable — depends on C5 accepted-value set] |
| E4 | eligibility · issuance signals | decision-table | L1 | automated | upgrade with `Origin: ""` (empty, not absent) | connection established | refused by existing origin rule; no capability |
| E5 | eligibility · held plane requires request-borne capability | decision-table | L1 | automated | filesystem denial, request carries no capability header | denial evaluated | not suspended; 403 returned; entry recorded as `degraded:ineligible` |
| E6 | eligibility · held plane requires request-borne capability | BVA | L1 | automated | filesystem denial, capability header present but value off by one byte | denial evaluated | treated exactly as absent; no prompt |
| E7 | eligibility · capability dies with its connection | state-transition | L1 | automated | capability issued, socket closed, then a request echoes it | denial evaluated | value resolves to no socket; ineligible |
| E8 | eligibility · deferred plane needs only a live operator channel | decision-table | L1 | automated | network-guard denial from `203.0.113.9`, zero operator channels connected | denial evaluated | no prompt raised; denial still recorded in ring buffer |
| E9 | eligibility · deferred plane needs only a live operator channel | decision-table | L1 | automated | same denial, one operator channel connected | denial evaluated | prompt raised on that channel; request stays denied, never suspended |
| E10 | registry · bounded and expiring | BVA | L1 | automated | registry filled to capacity−1 | one more pending entry | accepted | 
| E11 | registry · bounded and expiring | BVA | L1 | automated | registry at capacity | one more denial | [NEEDS CLARIFICATION: input — exact capacity, C2] recorded without prompting; no eviction of a live entry |
| E12 | registry · settled at most once | state-transition | L1 | automated | one pending entry, two `grant_response` frames | second arrives 10ms after first | second is a no-op; verdict unchanged; no second store write |
| E13 | registry · keyed by plane + normalised subject | equivalence | L1 | automated | two denials naming `/a/b` and `/a/b/` on the filesystem plane | both recorded | one entry, not two |
| E14 | registry · keyed by plane + normalised subject | equivalence | L1 | automated | filesystem denial for `/a/b` and cwd denial for `/a/b` | both recorded | two distinct entries; settling one leaves the other pending |
| E15 | forbidden-subject · subtree relation both directions | EP | L1 | automated | candidate `~/.ssh/keys` | forbidden rule applied | refused (descendant) |
| E16 | forbidden-subject · subtree relation both directions | EP | L1 | automated | candidate `/Users` on a machine whose home is `/Users/robson` | ladder computed | not offered (contains a forbidden directory) |
| E17 | forbidden-subject · component-wise comparison | BVA | L1 | automated | granted subtree `/repo`, candidate `/repo-secrets/x` | containment evaluated | not contained — string-prefix must not match |
| E18 | forbidden-subject · filesystem-canonical comparison | EP | L2 | automated | candidate `~/.SSH` on a case-insensitive volume | forbidden rule applied | refused |
| E19 | forbidden-subject · sensitivity probed from volume | decision-table | L2 | automated | case-sensitive volume mounted on a case-insensitive host, candidate differing only in case | containment evaluated | treated as distinct; sensitivity read from the volume, not the platform |
| E20 | registry · repeat prompting rate limited | BVA | L1 | automated | same subject denied N times | N at the per-subject backoff boundary | [NEEDS CLARIFICATION: trigger + observable — C1 constants] |
| E21 | registry · per-channel bound | BVA | L1 | automated | one capability emitting denials against distinct subjects up to its share | share boundary crossed | further denials from it recorded without prompting |
| E22 | registry · per-channel bound isolates requesters | decision-table | L1 | automated | requester A at its per-channel bound, requester B idle | B's denial arrives | B still prompts; A still suppressed |
| E23 | registry · starvation diagnosable | decision-table | L1 | automated | suppression caused by per-channel bound vs by global cap | each occurs | log/metric distinguishes the two reasons |
| E24 | ladder · nearest checkout root bounds | state-transition | L1 | automated | subject in checkout `/a/b` nested inside checkout `/a` | ladder computed | truncates at `/a/b`, not `/a` |
| E25 | ladder · worktree marker | EP | L1 | automated | subject inside a linked worktree where `.git` is a **file** | ladder computed | checkout root recognised |
| E26 | ladder · real-path detection | EP | L1 | automated | subject reached through a symlinked checkout directory | ladder computed | root detected on the real path; every rung is an ancestor of the real path |
| E27 | ladder · missing `$HOME` | EP | L1 | automated | `$HOME` unset, subject outside any checkout | ladder computed | still bounded at mount point; every rung passes the forbidden rule |
| E28 | ladder · subject is the boundary | BVA | L1 | automated | subject **is** the checkout root | ladder computed | ladder contains exactly that subject |
| E29 | ladder · subject is an exclusive boundary | BVA | L1 | automated | subject is the home directory | ladder computed | ladder empty; no rung offered |
| E30 | YOLO · time-boxed | BVA | L1 | automated | session with chosen duration | clock advanced to duration−1s, then +1s | active, then inactive; next denial prompts or refuses as if never active |
| E31 | YOLO · expiry not extended by use | BVA | L1 | automated | session with duration D, continuous auto-allows throughout | clock reaches D | session ends at the originally fixed time |
| E32 | YOLO · duration set | EP | L3 | automated | activation UI | operator opens it | [NEEDS CLARIFICATION: input — shipped duration set, C3] |
| E33 | YOLO · scope is a set of roots | decision-table | L1 | automated | session with roots `/repo` and `/scratch` | denial for `/scratch/x` | auto-allowed |
| E34 | YOLO · scope containment on real path | EP | L1 | automated | session scoped to `/repo`; path inside `/repo` only before symlink resolution | denial evaluated | not auto-allowed |
| E35 | YOLO · adding a root does not extend expiry | BVA | L1 | automated | active session, 3 min remaining | root added | still ends at the original time |
| E36 | YOLO · never reverses an explicit refusal | state-transition | L1 | automated | operator denied `/repo/.env`; YOLO later activated scoped to `/repo` | `/repo/.env` denied again | not auto-allowed; recorded as refused-by-prior-refusal |
| E37 | YOLO · remembered refusal is durable | state-transition | L1 | automated | refusal recorded, server restarted | same subject denied under an active YOLO session | not auto-allowed; refusal survived the restart |
| E37b | YOLO · remembered refusal is clearable | state-transition | L1 | automated | durable refusal, operator clears it on the Access surface | same subject denied again | prompts again rather than staying refused |
| E38 | YOLO · default scope passes the forbidden rule | decision-table | L1 | automated | session whose `cwd` is `$HOME` | activation offered | `$HOME` neither offered nor selected; falls back to narrowest legal rung |
| E39 | YOLO · many roots never become unscoped | state-transition | L1 | automated | session with 10 roots added | denial outside all of them | still prompted or refused |
| E40 | YOLO · env activation fails whole | decision-table | L1 | automated | env names 2 valid roots and 1 unresolvable | server starts | YOLO inactive; not unscoped; not activated on the valid subset |
| E41 | YOLO · env value syntax | EP | L1 | automated | single root / multiple roots / explicit unscoped / unparseable | each parsed | first three activate as specified; unparseable leaves YOLO inactive |
| E42 | dialog · allow-always never pre-selected | decision-table | L3 | automated | filesystem prompt rendered | dialog opens | no verdict control is pre-selected or focus-defaulted to allow-always |
| E43 | dialog · allow-once absent on deferred planes | decision-table | L3 | automated | network prompt rendered | dialog opens | allow-once control absent from the DOM, not present-and-disabled |
| E44 | dialog · ladder rendering | decision-table | L3 | automated | filesystem prompt whose denial offers 3 rungs | dialog opens | exactly 3 selectable rungs; narrowest pre-selected; no free-text input present |
| E45 | dialog · no ladder control when none offered | decision-table | L3 | automated | cwd prompt with no ancestors offered | dialog opens | no ladder control rendered at all |
| E46 | dialog · hostile subject rendered inert | EP | L3 | automated | CORS origin `https://<img src=x onerror=alert(1)>.example.com` | dialog opens | rendered as text; no element created from it; no script executes |
| E47 | registry · verdict refused for an unoffered subject | decision-table | L1 | automated | verdict naming a directory the denial did not offer | verdict submitted | refused; no grant written |
| E48 | registry · verdict accepted for an offered ancestor | decision-table | L1 | automated | verdict naming an offered rung | verdict submitted | grant written, recording the subject it was widened from |
| E49 | settings · prompting opt-in default off | decision-table | L1 | automated | fresh install, no config | denial occurs | no dialog; denial recorded and answerable from the Access surface |
| E50 | sidebar-header · pill is conditional | decision-table | L3 | automated | no active YOLO session | sidebar header renders | row 1 contains exactly today's controls; no YOLO pill |
| E51 | eligibility · reporting mode is record-only on every plane | decision-table | L1 | automated | `hostGate.mode = report`, live operator channel, prompt-eligible filesystem denial | denial evaluated | no dialog on any channel; existing denial returned; recorded reason names the Host-admission mode |
| E52 | eligibility · reporting mode gates deferred planes too | decision-table | L1 | automated | `hostGate.mode = report`, live operator channel, network denial | denial evaluated | no dialog; denial still recorded and answerable on the Access surface |
| E53 | eligibility · enforcing mode restores prompting | decision-table | L1 | automated | `hostGate.mode = enforce`, capability-bearing filesystem denial | denial evaluated | dialog raised; request suspended |
| E54 | settings · unavailability is surfaced, not silent | decision-table | L3 | automated | `hostGate.mode = report` | Access page opened | states no dialog will be raised and why; denials still listed and answerable; prompting toggle rendered inert, not hidden |
| E55 | settings · no-capability browser is surfaced | decision-table | L3 | automated | browser issued no prompt capability (e.g. `Sec-Fetch-Site` absent) | Access page opened | states this browser will not receive dialogs, and why |
| E56 | dialog · no verdict is emphasised | decision-table | L3 | automated | held prompt rendered | dialog opens | no answer pre-selected, focus-defaulted, or visually emphasised over the others |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | registry · suspended request survives connection timeout | threshold | L1 | automated | one held request across the 10s Fastify `connectionTimeout` | request not terminated at 10s; socket timeout restored on finish | [NEEDS CLARIFICATION: window — max hold, C6] |
| P2 | registry · prompt-volume controls | tail-latency | L2 | automated | 500 denials across 50 distinct subjects from one capability | p95 denial-path added latency | [NEEDS CLARIFICATION: threshold — C1] |
| P3 | ladder · computation cost on the denial path | tail-latency | L1 | automated | denial 12 levels deep, ladder computed per denial | p95 ladder computation < 5ms | 1000 iterations |
| P4 | registry · no leak across settled entries | soak | L1 | automated | 10k prompt→settle cycles | RSS delta < 10MB; registry size returns to baseline | 10k cycles |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | dialog · first answer wins across clients | state-convergence | L3 | automated | two browsers, same pending prompt | browser A answers | B's dialog unmounts; no residual backdrop; B cannot submit a second verdict |
| F2 | dialog · dismissal equals deny | state-transition | L3 | automated | open prompt | operator presses Escape | converges to denied; nothing persisted |
| F3 | dialog · held countdown | state-convergence | L3 | automated | held prompt with remaining time | time elapses without an answer | converges to expired; dialog removed; ledger row shows nothing written |
| F4 | dialog · deferred copy | state-transition | L3 | automated | network prompt | dialog opens | states the verdict applies to a later attempt; no waiting/countdown affordance |
| F5 | YOLO · indicator is not single-homed | state-convergence | L3 | automated | YOLO active, sidebar header not rendered | session surface in scope displayed | still indicates active YOLO and remaining time |
| F6 | YOLO · indicator undismissable | state-transition | L3 | automated | YOLO active | operator attempts to dismiss the indicator | remains rendered |
| F7 | YOLO · all surfaces share one session | state-convergence | L3 | automated | activated from the directory settings page | Access page opened | shows the same session, not a second one |
| F8 | dialog · inline YOLO nudge is not a fourth verdict | decision-table | L3 | automated | filesystem prompt | operator activates YOLO from within the dialog | the pending denial still requires an explicit verdict |
| F9 | dialog · reconnect mid-prompt | state-transition | L3 | automated | prompt open, WS drops and reconnects | reconnection completes | converges to a single consistent state — re-rendered if still pending, removed if settled meanwhile |
| F10 | mockup parity · visual design | visual/subjective | — | manual-only | `mockups/index.html` vs shipped UI | human compares | [judgment: spacing/typography match the mockup — no automatable observable] |
| F11 | dialog · theme correctness | visual/subjective | — | manual-only | prompt in all 4 themes, dark + light | human looks | [judgment: severity tokens read correctly in every theme] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | registry · released on abort | fault-injection (abort) | L1 | automated | client aborts a suspended request | abort mid-hold | entry released; socket timeout restored; no orphaned handle; nothing persisted |
| X2 | registry · suspension ceiling | fault-injection (delay) | L1 | automated | operator never answers | hold exceeds its maximum | [NEEDS CLARIFICATION: observable — C6 cap and requester outcome] |
| X3 | registry · resumed request re-runs the guard | fault-injection (race) | L1 | automated | subject replaced by a link to another location after the verdict | request released | guard re-runs and denies |
| X4 | registry · revoke while pending | fault-injection (race) | L1 | automated | grant revoked between verdict and release | request released | re-run guard reflects the revocation |
| X5 | eligibility · every degradation fails closed | fault-injection (abort) | L1 | automated | browser gateway unavailable when a prompt would be pushed | denial evaluated | denial stands; no allow; recorded as degraded |
| X6 | registry · capacity exhaustion fails closed | fault-injection (overflow) | L1 | automated | denials beyond capacity | overflow | recorded without prompting; no entry silently dropped in favour of a new one; no allow |
| X7 | YOLO · unresolvable scope root at activation | fault-injection (abort) | L1 | automated | chosen root deleted between offer and activation | activation submitted | activation refused; no session created |
| X8 | ladder · unresolvable subject | fault-injection (abort) | L1 | automated | subject cannot be realpath-resolved | ladder computed | refused rather than compared on its unresolved form |
| X9 | plane registration · deferred plane declaring YOLO eligibility | fault-injection (invalid config) | L1 | automated | a deferred-mode plane declares `yoloEligible` | registration | rejected, not honoured |
| X10 | YOLO · unavailable without enforce | fault-injection (config) | L1 | automated | Host admission in reporting mode | operator opens a YOLO control; env-activated session attempted at startup | no session becomes active; control states the reason rather than hiding; no automatic verdict on any plane |
| X11 | env activation · headless | fault-injection (no browser) | L2 | automated | env-activated YOLO, no browser connected | non-browser client's request denied by containment | remains denied |
| X12 | prompting kill switch | decision-table | L2 | automated | `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1` | denial occurs | no prompt; existing grants unaffected; toggle rendered inert, not hidden |

---

## Coverage summary

- Requirements covered: 38/38 testable requirements across the 12 spec deltas
- Scenarios by class: edge 57 · perf 4 · frontend 11 · error 12
- Scenarios by level: L1 52 · L2 6 · L3 24 · manual-only 2
- Scenarios by disposition: automated 82 · manual-only 2
- Blocked on clarification: 6 rows (E3, E11, E20, E32, P1, P2, X2 minus E37/X10, now resolved by C4 and the enforce-precondition decision)

## New infra needed

- **A case-insensitive volume fixture** for E18/E19. The repo's L1 vitest tier
  runs on whatever the host provides, so "probed from the volume" cannot be
  asserted from a single machine. Route: L2 `qa/tests/`, which already runs
  per-OS, plus a disk-image fixture on macOS/Linux. Flagged rather than assumed.
- No new harness otherwise: L1 vitest, L2 `qa/tests/*.sh`, and the L3 Playwright
  docker harness all exist.
