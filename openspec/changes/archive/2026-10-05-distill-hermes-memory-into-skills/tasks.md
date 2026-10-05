# Tasks — distill-hermes-memory-into-skills

> Captured in explore mode. Implementation is a later phase; these are the shape of the
> work, not a committed breakdown. Run `plan-proposal` / scenario-design before applying.

## 1. Candidate selection + scope
- [ ] Read `memories` where `target ∈ {memory, failure}` AND `project = session projectName` (never cross-project; `user` and `project IS NULL` excluded) → verify: a differing-project row and a global row are both non-candidates.
- [ ] Maturity gate = *settled*: `now - last_referenced ≥ T_age` (write-bump semantics; NO reference-count in v1) → verify: a recently-edited row is excluded.

## 2. Shareability / privacy gate
- [ ] Secret/PII/absolute-path scrub reusing the `add-automatic-session-kb-index` discipline → verify: seeded secret fixture is hard-rejected, not "best-effort" written.
- [ ] Project-technical vs personal classification → verify: a personal-flavored entry is no-moved.

## 3. Classifier (subagent fan-out)
- [ ] One subagent per topic bucket → `{entryId → hostSkill, confidence, rationale}` (faq-mine pattern) → verify: ambiguous/low-confidence entries default to no-move.
- [ ] Emit an approval-required routing table → verify: no `memory(action:remove)` fires pre-approval.

## 4. Author + trigger-tune
- [ ] Append surviving entry to host skill `references/lessons.md` (create sidecar + SKILL.md pointer if absent) → verify: sidecar is a kb source and `kb_search` finds the lesson.
- [ ] Propose host-skill `description` trigger update covering the lesson's situation → verify: host skill fires on the lesson's phase.
- [ ] Content-hash sidecar entries for idempotency → verify: re-run does not double-author.

## 5. Move-out
- [ ] Author-then-remove ordering; remove via `memory(action:remove)` with exact stored bytes; confirm exactly-one via row-count check (NOT `success`, which a multi-copy `failure` remove can return) → verify: crash-between leaves a recoverable duplicate; a >1/0 match aborts; no raw DELETE on `sessions.db`.

## 6. Upstream design spec (deferred, no code in v1)
- [ ] Document the future-write reroute contract for `pi-hermes-memory` (new phase-lesson → skill sidecar destination) → verify: contract reviewed, no in-repo dependency on it.

## Tests (folded from test-plan.md — all L1 vitest; exemplar: `packages/kb/src/__tests__/kb.test.ts` for the node:sqlite temp-fixture harness)
- [ ] Maturity boundary (test-plan #E1): entry `last_referenced` 13d ago (input) · run gate (trigger) · excluded, 15d-ago sibling eligible (observable).
- [ ] Shareability excludes user (test-plan #E2): `target=user` entry (input) · candidate selection (trigger) · never a candidate (observable).
- [ ] Scrub hard no-move (test-plan #E3): entry with API token + absolute path (input) · scrub (trigger) · no-move, no sidecar write (observable).
- [ ] Confidence auto-drop boundary (test-plan #E4): route confidence 0.69 vs 0.71 (input) · classify (trigger) · 0.69 dropped, 0.71 surfaced (observable).
- [ ] Scope excludes cross-project + global (test-plan #E5): entry `project`≠session projectName, and `project IS NULL` (input) · select (trigger) · both non-candidates (observable).
- [ ] Dedup near-match boundary (test-plan #E6): sidecar lesson at similarity 0.86 vs 0.84 (input) · author (trigger) · 0.86 skipped, 0.84 authored (observable).
- [ ] Config-conditional backstop warn (test-plan #E7): `knowledge_base.json` omits `.pi` (input) · run pass (trigger) · off-phase-unretrievable warning emitted (observable).
- [ ] Trigger-tuning proposal (test-plan #E8): lesson authored into skill whose `description` lacks the situation (input) · author (trigger) · proposed `description` update includes the situation token (observable).
- [ ] Over-match abort (test-plan #X1): `old_text` matches 2 rows incl. distinct-scoped failure copies (input) · move-out (trigger) · count-check >1 → abort, no removal, flagged (observable).
- [ ] Miss abort (test-plan #X2): `old_text` matches 0 rows (input) · move-out (trigger) · count-check 0 → abort, flagged (observable).
- [ ] Crash-between loss-safety (test-plan #X3): abort after author, before remove (input) · re-run (trigger) · entry still in Hermes, dedup skips re-author — no loss/no double (observable).
- [ ] No raw DELETE invariant (test-plan #X4): any successful move-out (input) · move-out (trigger) · only `memory(action:remove)` used, zero raw `DELETE` on `sessions.db` (observable).
- [ ] No move before approval (test-plan #X5): routing table unapproved (input) · attempt move-out (trigger) · no `memory(action:remove)` before approval flag set (observable).

## Manual verification (deferred post-merge by ship-change)
- [ ] Routing correctness (test-plan: manual-only, #M1): human judges each memory is routed to the right host skill.
- [ ] Trigger-tuning quality (test-plan: manual-only, #M2): human judges the tuned `description` is correct and not over-broad.
- [ ] Privacy approval (test-plan: manual-only, #M3): human confirms no personal/mis-scoped entry is promoted before move-out.

## Validate
- [ ] `openspec validate distill-hermes-memory-into-skills` passes.
- [ ] `doubt-driven-review` on the move-out (irreversible) + `security-hardening` on the scrub gate.
