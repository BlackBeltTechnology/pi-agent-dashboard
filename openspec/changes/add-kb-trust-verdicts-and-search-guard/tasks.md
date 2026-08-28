# Tasks

Arms A (1–3) and B (4–5) are independently landable. Either may ship alone.
Phase 7 depends on arm B having run in the field, and is gated on measurement —
it may legitimately conclude "trim nothing".

## 1. Baseline and budget (land first — no behaviour change)

- [x] 1.1 Record the current search-latency median/p95 over the bundled fixture index as the pre-change reference (the 50 ms median budget from `kb-fts5-search-store` is the gate)
- [x] 1.2 Record current `kb dox lint` counts on this repo (`stale` / `missing` / `orphan`) — the population verdicts will label
- [x] 1.3 Write a failing test asserting result ORDER is byte-identical with verdicts enabled and disabled (D1); it must fail today only because the option does not exist (test-plan #E14)

## 2. Verdict core (`packages/kb/src/verdict.ts`)

Exemplar for all L1 rows in this section: the temp-git-repo pattern in
`packages/kb/src/__tests__/dox-triage.test.ts` (real git repo in tmp for
rename/triage assertions); pure-module tests need no pi runtime.

- [x] 2.1 Write failing tests for subject-SET resolution: an `agents` hit (a whole `# DOX —` section, since the chunker never splits by table row) resolves to the set of source files its resolvable rows document via `resolveRowPath`, capped at 8 in row order; sidecar `<File>.AGENTS.md` resolves as its own single-row section; a prose hit resolves to no subject; an unresolvable row yields no subject, never a guess (test-plan #E8, #E9)
- [x] 2.2 Write failing tests for the five labels — `FRESH` (exists, hash matches acked), `STALE` (exists, hash differs), `MOVED` (absent, git rename found → new path), `GONE` (absent, no rename / non-git / undetectable), `UNVERIFIED` (subject exists but no acked hash — the common first-run case, asserted NOT to conflate with STALE); plus existence-precedes-hash-gate: deleted AND never-acked = GONE, not UNVERIFIED (test-plan #E1–#E6)
- [x] 2.3 Write failing tests for the aggregation: hit verdict is worst-of (`GONE` > `MOVED` > `STALE` > `UNVERIFIED` > `FRESH`) plus per-label counts including the TOTAL resolvable count, so a capped check is never indistinguishable from a full one; a hit whose section has zero resolvable rows reports no verdict (test-plan #E7)
- [x] 2.4 Write a failing test that a subject with a MATCHING persisted stat baseline is never read (assert via a counting fake fs), and one that a missing/mismatched baseline falls back to hashing (test-plan #E11)
- [x] 2.5 Implement `verdict.ts` as a pure async `enrichHits(hits, ctx)` — reuses `resolveRowPath` and the acked store; no pi imports
- [x] 2.6 Implement `MOVED` via git rename detection (D3); ambiguous, non-git, and unstaged-move cases degrade to `GONE`, never to a guess
- [x] 2.7 Implement sidecar v2 in `dox-triage.ts`: acknowledgement persists `{sha256, size, mtimeMs}` per documented file; reads of a v1 sidecar (sha256-only) tolerate the absent stat fields (hash fallback, no crash); versioned field so a future v3 cannot silently misread (test-plan #E12)
- [x] 2.8 Implement the freshness caps: subjects >1048576 bytes (1 MiB — exact boundary, decided at planning) or binary are never hashed (matching stat baseline → stat-only `FRESH`, else `UNVERIFIED`); boundary test at exactly 1048576 (hashed) vs 1048577 (not hashed) (test-plan #E10)
- [x] 2.9 Assert enrichment performs no writes with verdicts enabled (D4) — no index mutation, no file writes, no deletes (test-plan #E15)
- [x] 2.10 Write a failing test for an unreadable subject (EACCES during hash): labelled `UNVERIFIED`, no crash, no partial verdict (test-plan #X2)
- [x] 2.11 Write a failing test for git unavailable at rename-batch time: absent subject degrades to `GONE`, no throw, no guessed path (test-plan #X3)

## 3. Wiring, render, and calibration

- [x] 3.1 Add `verdict: { label, counts } | null` to `KbHit` in `packages/kb/src/types.ts` and a `verdicts` flag to the enricher options (default ON for `agents` hits)
- [x] 3.2 Wire `enrichHits` as a post-search stage in `kb-extension` (store untouched, `store.search()` stays sync); re-run the 1.3 order test — it must now pass
- [x] 3.3 Render the verdict in `renderHits` (both `condensed` and `json`); test both forms, and that `null` renders nothing rather than a placeholder; counts render as "LABEL (n of m subjects checked)"
- [x] 3.4 Surface the verdict through `kb_search` in `kb-extension`; add the opt-in CLI flag to `kb search`; update the tool description to state that a verdict is a trust label and does not affect ranking
- [x] 3.5 Record the ADDITIVE enrichment latency measurement: median over a page whose checked subjects all exist (stat-gated hashing, subjects capped 8/hit, hashing capped 1048576 bytes, ONE batched rename-scan per repo) — advisory target 15 ms, RECORDED in `measurements.md`, deliberately NO CI assertion (decided at planning); record the delta against 1.1 (test-plan #P1)
- [x] 3.6 Implement the content-coverage field behind a default-OFF flag (D5), capped at 256 KB with a binary skip; tests: off → no subject read and no coverage field; on → own field, freshness verdict unchanged; read capped at 262144 bytes (test-plan #E13)
- [x] 3.7 Calibrate the coverage threshold against `eval/golden.*.json` via `run-fixtures.ts`; record the measured numbers in `measurements.md` and keep it default-OFF unless they justify the latency

## 4. Guard core (`packages/kb-extension/src/guard.ts`)

- [x] 4.1 Write a failing test asserting the shipped default is `warn` (decided at planning) and that `off`/`block` are reachable only through config; `KB_GUARD_MODE` env may select `off`/`warn` only (D14) (test-plan #E22, #E23)
- [x] 4.2 Write failing tests for the chain counter: 3 consecutive search actions fire (2 must not); `kb_search` / `kb_neighbors` / `kb_get` tool calls reset clean-slate; bash invoking the kb CLI resets; an interleaved edit does NOT reset (D7); an empty-query `kb_search` still resets (an attempt to consult is a consult) (test-plan #E16–#E18)
- [x] 4.3 Write failing tests for bash segment parsing: split on `|`, `||`, `;`, and newline; `cat f | grep x` counts, `rg x .` counts, `npm test` does not, `echo hi && ls` counts, `rg x || true` counts, a multi-line `find .` counts, a command starting with `kb ` resets; `timeout 60 rg` does NOT count — the documented D8 gap, asserted as accepted (test-plan #E19)
- [x] 4.4 Write failing tests for the ladder: firing 1 → warning, firing 2 → escalation, firing 3+ → block verdict ONLY in `block` mode; `warn` mode never emits a block (test-plan #E20)
- [x] 4.5 Write failing tests for suspension: `suspend` clamps to 1–20, junk is a no-op, re-suspend takes the max, `tickTurn` expiry restores a clean slate (D9) (test-plan #E21)
- [x] 4.6 Implement `guard.ts` as a pure module with no pi imports

## 5. Guard wiring

- [x] 5.1 Add `readDiscipline.guard.mode` to `config.ts` with validation and the agreed default; add the env override
- [x] 5.2 Register the guard's OWN `tool_call` hook in `extension.ts` (the existing hook is gated inside `dirAgentsPush` and is NOT reused); feed exactly once per invocation (`tool_result` must not double-count); reset set is processed BEFORE counting
- [x] 5.3 Deliver warnings by prepending to the tool result; act on block verdicts in `tool_call` (the only hook that can block)
- [x] 5.4 Register the `kb_guard_pause` tool and tick the turn clock on `turn_start`
- [x] 5.5 Assert the guard degrades silently — any failure inside it leaves tool results untouched (test-plan #X1)
- [ ] 5.6 Verify against a real session: guard fires on a source-grep chain, `kb_search` clears it, `kb_guard_pause` suspends it

## 6. Documentation

- [x] 6.1 DocScribe: `docs/` prose for the verdict labels and the guard ladder, caveman style
- [x] 6.2 Update the `kb-read-discipline` table in root `AGENTS.md` to name the verdict labels (what to do on `STALE` / `GONE`)
- [x] 6.3 Add DOX rows for `packages/kb/src/verdict.ts` and `packages/kb-extension/src/guard.ts` in their directory `AGENTS.md` files

## 7. Gate-trim: measure whether the per-turn prose still earns its slot

The `Docs-First Gate` costs ~694 tokens of a ~3,478-token `AGENTS.md`, injected
every turn (20.0%; ~820 with the redundant `Investigation Protocol` section).
The guard delivers the compliance half at violation time instead. This phase
asks whether the prose half can shrink — it does NOT assume it can.

- [x] 7.1 Establish guard coverage BEFORE trimming anything: verify the hooks fire for subagent tool loops, not only the main session (guard state is per-process). A surface the guard cannot see MUST keep its prose
- [ ] 7.2 Record the guard firing rate over a representative window of real sessions; a high rate with full prose present is evidence the prose is not carrying the rule (test-plan #M2, manual-only — deferred post-merge)
- [x] 7.3 Classify every line of the gate as ROUTING (which call / which lane / which corpus) or PRESSURE (do-this-first framing). Routing is not a trim candidate — the `doc_type` lane pick alone measures P@1 0.041 → 0.227 on file lookups and 0.150 → 0.067 against it on prose queries
- [x] 7.4 Build the trimmed treatment: drop PRESSURE lines and fold the `Investigation Protocol` section into the gate table; keep the routing table, the corpus boundaries, and the fall-through rule
- [ ] 7.5 A/B the treatment with `scripts/ab-context` per the `ab-test-context-injections` skill (at `~/.pi/agent/projects-memory/pi-agent-dashboard/skills/ab-test-context-injections/`); judge non-inferiority on the task battery, with kb-tool-usage rate as a named secondary metric (test-plan #M1, manual-only — deferred post-merge, gated on 7.2 field data)
- [ ] 7.6 If non-inferior: land the trim, and record the measured token delta. If inferior or inconclusive: land nothing and record why — a null result here is a valid outcome
- [x] 7.7 Leave the `project-init` seeded templates UNTRIMMED regardless of the result — seeded projects may never install kb-extension, so their prose is the only enforcement they have; test: both template variants still carry the substitution-table rows (test-plan #E24)
