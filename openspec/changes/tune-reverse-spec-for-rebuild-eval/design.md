## Context

See proposal.md — Why. Run 1 of the fixture eval (`eval/score.md`) left three
defects plus two deferred runs:

- The merge dropped R11 (`src/errors.ts:19-24` `HTTP_STATUS` table) and I6
  (`src/http.ts:31-33` 500 `INTERNAL` fallback). Hypothesised cause (run-1 merge
  transcript not kept): `prompts/generator-rebuild.md:62-63` STEP 3 says "Interface plumbing (exit codes, output formatting, id formats) belongs in
  the spec", and `prompts/auditor-rebuild.md:36-39` check 2 says "exit codes or output
  formatting belong in the spec". An HTTP status reads as "exit code"-like plumbing.
- The R9 rule named `config.autoApproveLimit` (in-code property) instead of
  `approval.autoApproveLimit` (`eval/fixture/src/config.ts:14`). The generator
  (`generator-rebuild.md:74`) says "name the key" without saying which key.
- 8/8 capability audits stayed `revise` after 2 rounds, mostly confidence over-tagging
  on multi-location and absence claims. The mechanical rules
  (`references/provenance.md:70-72`, `generator-rebuild.md:90-92`, `SKILL.md:113`) were
  added late in run 1 and are unmeasured. Nothing enforces them before the auditor, and
  the repo's own fragment example violates them: `references/package-templates.md:163`
  has an entity cite `lib/loans.py:18; db/schema.sql:12-21` tagged `confirmed`. The
  merge rule says nothing about how cites of merged items combine.

All edits live under `packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild/`;
`scripts/guard.mjs` has L1 tests in `packages/eng-disciplines/src/__tests__/`
(`guard.test.ts`, `lint-spec.test.ts`, `skill-text.test.ts`).

## Goals / Non-Goals

**Goals:**
- Catalog boundary stated once, identically, in generator, merge (SKILL.md step 6) and
  auditor.
- Literal external config key in rule statements.
- A deterministic pre-audit check for the one mechanically detectable confidence error.
- Fixture re-run (run 2) meeting every `score.md` target, plus M5 id carry-over (run 3),
  plus the deferred real-target run.

**Non-Goals:**
- Changing the answer key or relaxing targets in `score.md`. A true finding outside the
  key (e.g. the fixture CLI error→exit mapping, `cli.ts:25-32`) counts as a grounded
  extra under `score.md` §2, never toward recall.
- Linting absence claims mechanically (needs natural-language judgment; stays with the
  auditor).
- New pipeline stages, new subagent roles or model-routing changes.
- Any runtime/server code.

## Decisions

**D1 — Boundary by "decision on outcome", anchored by named examples.** A rule is
anything that decides a caller-visible outcome from domain data or failure class:
HTTP/WS/CLI error maps (which failure class yields which status, code, reply or
non-success exit) and fallback handlers that hide or substitute details. Plumbing =
numbering or formatting choices that encode no decision: a non-success exit status
that is the same for every failure (only a mapping that tells failure classes apart is
a rule), output formatting, id formats, subscribe/unsubscribe mechanics. The fixture
CLI (`cli.ts:26` unknown command → 2, `:30` `OrderError` → 1) therefore IS a rule —
outside the key, so a grounded extra. The abstract criterion alone is lexical-prone
("an HTTP status is also a number"), so the sentence names HTTP/WS/CLI error maps as
rules explicitly. Alternative: criterion only — rejected (run 1 showed models pattern-
match "exit codes"). The same boundary text is added to generator STEP 3, auditor
check 2 and (new) the SKILL.md merge step; a `skill-text.test.ts` case asserts it in
all three after whitespace normalisation (prompts are hard-wrapped). Text tests prove
wording only; behaviour is proven by the eval (4.1).

**D2 — Literal key rule.** Generator STEP 3 gap bullet (`generator-rebuild.md:74`): "name the key exactly as read
from the external source (the string passed to the file/env/service lookup), not the
in-code property". The merge keeps rule statements verbatim, so no merge change beyond
a "do not rewrite key names" note. Alternative: carry the key as a separate fragment
field — rejected; adds schema surface for one string.

**D3 — `guard.mjs lint-cite <file>...`.** New read-only subcommand, guard conventions
(`guard.mjs:41`, `lint-spec` at `:575-590`): findings → exit 1; no args / missing file
→ exit 2 + stderr; clean → exit 0. USAGE (`:65-78`) and header comment (`:2-41`)
updated.
- `.md`: `<!-- cite: ref=..., confidence=... -->` with optional leading whitespace
  (model/completeness cites are indented, `package-templates.md:56,58,132`); finding
  when `confidence=confirmed` and the `ref` value (from `ref=` up to the next
  `, confidence=` or `-->`) holds ≥2 `path:line[-line]` tokens, whatever the separator
  (`;`, `,`, `and`), or when `<!-- cite:` has no
  `-->` on the same line (cites are single-line — rule added to `provenance.md`).
  Reports `file:line`.
- `.json`: `JSON.parse` + recursive walk over every object having both `cite` and
  `confidence` (same ≥2-token test on the `cite` string) (covers `rules[]`, `entities[]`, `entities[].fields[]`, quirks, gaps;
  `entry_points[]` has no `confidence` → skipped). Reports `file#<json-pointer>`
  (e.g. `#/entities/0/fields/2`); robust to key order and one-line JSON.
- Wiring (SKILL.md): lint `_fragments/*.json` + `_fragments/*.spec.md` after the
  generators and before each merge; lint `rules.md model.md quirks.md gaps.md` +
  `capabilities/*/spec.md` at the end of EVERY step-6 merge, before step 7 (capability
  auditors read the catalogs, `auditor-rebuild.md:21`). A finding only in merged output
  = merge error → re-run the merge applying merge rule 4 (catalogs are never hand-
  edited, `SKILL.md:154-156`). `completeness.md` is linted after step 10, before the
  cross-cutting audit. On fragment findings the session may only
  LOWER confidence to `inferred` in the fragment — the item in `<cap>.json` and the
  matching cite comment in `<cap>.spec.md` together (mechanical, no judgement; an
  explicit exception to "only generators write fragments", `SKILL.md:91-94`);
  narrowing to one location is routed to the generator as FINDINGS. A lowered
  confidence changes the catalog, so the step-8 re-audit set applies as usual.
- Merge cite policy (SKILL.md merge rule 4): merged item cite = union of source
  locations; union of >1 location caps confidence at `inferred`.
- Auditor/provenance alignment: `provenance.md:58-59` table + auditor check 5
  (`auditor-rebuild.md:46-49`) state that a multi-location or absence cite is `inferred`
  BY RULE; a tag lowered only by that cap is not a confidence error (else the auditor
  re-creates run-1 churn).
- Gate: `lint-cite` clean is added to the step-13 gate summary and step-14 promotion
  condition (`SKILL.md:173-177`) and to the `G` subcommand list (`SKILL.md:39-40`).
- Template fix: `package-templates.md:163` example → `inferred`; generator note that a
  multi-location entity cite is `inferred` (`generator-rebuild.md:140`).
Alternative: let the auditor catch it — what failed to converge in run 1. Alternative:
auto-rewrite in the script — rejected; guard stays lint-only like `lint-spec`.

**D4 — Eval order.** Run 2 = fresh fixture run after D1–D3 (all targets). Run 3 = re-run
supplying run 2's package (M5). `score.md:40` M5 row is reworded "previous run →
re-run" (wording only; target unchanged). Real-target run last, on one `packages/server/src` area
via kb discovery, promoted only to `.reverse-spec-scratch/promoted/`. Run 2 failing a
target loops back to prompt edits (max 2 tuning iterations), then escalates via
`ask_user`.

## Risks / Trade-offs

- [Widened boundary bloats `rules.md` with formatting-level items] → explicit plumbing
  list + a precision target (≥90%) already in `score.md` catches ungrounded extras.
- [Tuning overfits the fixture] → D1 phrased by outcome criterion; real-target run is
  the generalisation check.
- [`lint-cite` misses multi-line cite comments] → single-line rule in `provenance.md`;
  unterminated `<!-- cite:` is itself a finding; tests cover md (indented) and json
  (nested, reordered keys, one-line).
- [Audits still don't converge in 3 rounds] → record per-finding-class counts in
  `score.md` notes; escalate rather than loosen the gate.
- [Real-target run writes into the repo] → existing protected-root guard + M11 check:
  snapshot `git status --porcelain` before the run, diff after (`SKILL.md:168-170`);
  only `.reverse-spec-scratch/` (git-ignored, `.gitignore:50`) may change.

## Migration Plan

Prompt/reference/script edits only. No data or package-format change: existing rebuild
packages stay valid (`lint-cite` may flag old packages on re-run; the fix is lowering
confidence). Rollback = revert the commit.

## Open Questions

- Which `packages/server/src` area to use for the real-target run (pick a small,
  well-indexed one at run time; does not change tasks).
