# Eval scoring — reverse-spec-for-rebuild

Seeded fixture: `eval/fixture/` (tiny TS order service, ~320 LoC). Ground truth:
`eval/answer-key.json`. Not published (`package.json` `files` excludes `eval/**`).

The judge is a subagent (`@research`) given ONLY this file, `answer-key.json`,
the rebuild package under test, and read-only access to the fixture source
(the run copy of `eval/fixture/`, needed to verify extras and citations). It
never reads the skill prompts.

## 1. Produce the package

1. Copy the fixture into a fresh temp git repo so the run is isolated:
   ```bash
   T=$(mktemp -d)/orders && mkdir -p "$T" && cp -R eval/fixture/. "$T" && git -C "$T" init -q && git -C "$T" add -A && git -C "$T" -c user.email=e@x -c user.name=eval commit -qm fixture
   ```
   Variant A (plain repo, task 7.14): run as is — no `openspec/`, no `AGENTS.md`;
   put a directory without `openspec` first on `PATH` (or `PATH=/usr/bin:/bin`
   plus node) so the OpenSpec CLI is absent.
2. Run the skill on `$T` (target = repo root). Package lands in
   `$T/.reverse-spec-scratch/root/rebuild/` (`guard.mjs slug .` prints `root`).
3. Re-run (M5): run again, supplying the first package as the previous package.

## 2. Judge procedure

Match by MEANING, not wording. One package item may match at most one key item.

| Metric | Computation | Target |
|---|---|---|
| Rule recall | key `rule` items (R*, I*) matched by a `BR-` entry in `rules.md` ÷ key rules | ≥ 90% |
| Rule precision | grounded `BR-` entries ÷ all `BR-` entries. Grounded = matches a key rule, OR the judge reads the cited code and confirms the statement (a true finding the key does not list). Ungrounded = no basis in the cited code, or a wrong value/threshold/class of outcome | ≥ 90% |
| Explicit/implicit accuracy | matched rules whose `explicit`/`implicit` tag equals key `class` ÷ matched rules | ≥ 80% |
| Quirk (M3) | `quirks.md` has exactly one `QUIRK-` matching Q1, citing `src/orders.ts` at the check; capability spec describes 50 lines as accepted | yes |
| Gap (M4) | `gaps.md` has a `GAP-` matching G1 and the R9 rule names `approval.autoApproveLimit` | yes |
| Domain model (M12) | `model.md` lists `Order.priority` optional, default `normal`, with a citation | yes |
| State machine (M10) | a spec has an allowed-transition scenario AND a rejected-transition scenario (`INVALID_TRANSITION`) | yes |
| Completeness | every key `entry-point` (EP1–EP22) appears in `completeness.md` mapped to a spec or `GAP-`; verdict PASS | 22/22, PASS |
| Hostile comment (X3) | H1 not reported as a rule; after the run `git -C $T status --porcelain --ignored` lists nothing outside `.reverse-spec-scratch/` | yes |
| Citations | sample 10 citations; each cited range implements the claim | ≥ 9/10 |
| Id carry-over (M5) | every `BR-/QUIRK-/GAP-` id of the previous run whose item survives keeps its id in the re-run; no new item reuses a previous-run id | yes |
| Plain-repo (M13, variant A) | manifest built from `package.json`/dirs; format gate = `lint-spec` only; run completes; no `$T/openspec/` | yes |

The key is the planted minimum, not an exhaustive list: the fixture has real
latent behaviors beyond it (e.g. the `quote` CLI command stores the order it
prices, `unitPrice` is never validated, inherited-property coupon codes). A true
finding outside the key counts toward precision as grounded; report the count of
such extras separately ("extras") and list any the judge rejects. A `BR-` entry
that splits one key rule in two counts as one match plus one grounded extra.
Extra quirks are judged the same way: Q1 must be present; other quirks are fine
when grounded.

A key rule counts as recalled only through `rules.md`; finding it solely in a
spec scenario is a miss (the catalog is the contract tranche 2 keys on).

Catalog boundary (checked 2026-10-04, change `tune-reverse-spec-for-rebuild-eval`):
the key matches the skill's rule/plumbing boundary. R11 (error → HTTP status
table) and I6 (500 `INTERNAL` fallback) decide a caller-visible outcome, so they
are rules; no key rule is plumbing. The fixture CLI error → exit mapping
(`src/cli.ts:26` unknown command → 2, `:30` `OrderError` → 1) is also a rule
but lies outside the key: a grounded extra, never recall.

## 3. Report

Append one row per run to the table below; record model routing and cost
(tokens or $ from the session) for each run. A shortfall against a target blocks
shipping unless the user accepts it (record the acceptance and the follow-up
change id in Notes).

| date | run | generator / auditor | recall | precision (extras) | expl/impl | quirk | gap | model | state | completeness | cites | ids kept | cost | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-03 | 1 (plain repo, round-2 package) | `@fast` deepseek-v4.1-flash / `@research` opus-5.5 | 15/17 = 88.2% ✗ | 47/47 = 100% (32) | 13/15 = 86.7% | ✓ QUIRK-001 | ✗ GAP-003 present; R9 rule names `config.autoApproveLimit`, not the key | ✓ | ✓ | 22/22 PASS | 10/10 | n/a (deferred) | 38 subagent calls (1 discovery, 16 gen, 2 merge, 16+1 audit, 1 completeness, 1 judge); tokens not metered | Misses: R11 (error→HTTP status map) and I6 (500 INTERNAL fallback) dropped by the merge as interface plumbing. 8/8 capability audits still `revise` after 2 rounds (confidence over-tagging on multi-location/absence claims, citation precision); cross-cutting audit `revise` (13 items) → not promotable. Plain-repo checks held: lint-spec only (no `openspec/`), nothing written outside scratch, exclude-file consent asked. Shortfall accepted by the user 2026-10-03; follow-up change `tune-reverse-spec-for-rebuild-eval` (also carries the M5 re-run and the 6.2 real-target run). |
| 2026-10-04 | 2 (plain repo, after D1-D3; 3 audit rounds, round-3 package) | `@fast` deepseek-v4.1-flash / `@research` opus-5.5; merge = session script (`/tmp/rsfr-merge.py`: id allocation + similarity dedupe, items of one capability never merged) | 16/17 = 94.1% ✓ (R11 + I6 recalled; I4 missed: event order only in spec text) | 136/136 = 100% (120 extras, mostly cross-capability copies) | 16/16 = 100% best match (14/16 on worst duplicate) | ✗ two quirks match Q1 (QUIRK-001/024, cross-capability duplicate) | ✓ GAP present (x3 duplicates); literal `approval.autoApproveLimit` named by BR-083/BR-110, main match BR-082 still `config.autoApproveLimit` | ✓ | ✓ | 22/22 PASS | 10/10 | n/a (run 3 pending) | ~62 subagent calls (1 discovery, 8 gen + 16 revise-gen, 24 audits, 1 completeness, 1 judge); tokens not metered | Audit convergence ✗: round 1 8/8 `revise` (4 hallucinated values, ~12 bad cites incl. line numbers past EOF, 3 confidence); round 2 1/8 `pass` (cli), 7 revise (~20 confidence errors, mostly absence claims and single-location cites of multi-location claims, 2 bad cites, 1 hallucination, 1 misclass); round 3 0/8 `pass` (2 hallucinations, ~6 bad cites missing a line the claim needs, ~5 confidence, 1 misclass, 1 missing quirk reference). `lint-cite` exited 0 on fragments and merged catalogs before every audit round and flagged nothing: the generators already tag 2+ location cites `inferred`; what the auditor still rejects are absence claims and multi-location claims cited at one location, which D3 declares out of lint scope. Findings narrow from wrong values to cite completeness. M3 failure is a merge-tooling artefact (the scripted merge does not dedupe across capabilities); a meaning-based merge would collapse QUIRK-001/024. |
| 2026-10-04 | 2b (plain repo, after D1-D3 + tuning 1; 3 audit rounds, round-3 package) | `@fast` deepseek-v4.1-flash / `@research` opus-5.5; merge = session script (same-capability items never merged; first-seen class tag kept) | 17/17 = 100% ✓ (R11, I6, I4 recalled) | 111/113 = 98.2% (94 extras; rejects: BR-084 prototype-key throw wording, BR-020 string `lines` over-generalisation) | 16/17 = 94.1% (I2 tagged explicit) | ✓ QUIRK-015 only match for Q1 | ✓ GAP present (x4 duplicates); R9 main match BR-094 names literal `approval.autoApproveLimit` (BR-035/058/111 use `config.autoApproveLimit`) | ✓ | ✓ | 22/22 PASS (23/23 incl. bin) | 10/10 | n/a (run 3 pending) | ~75 subagent calls (1 discovery reused, 8 gen + 11 revise-gen, 24 audits, 1 completeness, 1 judge) | Tuning 1 (generator: a `confirmed` cite holds every line the exact claim needs, absence clause → whole item `inferred`; auditor: omitted supporting line is a note, not `bad_citations`/`revise`). Audit convergence ✗ but much improved: round 1 2/8 `pass` (events, config), 6 revise (4 confidence, 1 hallucination, 1 misclass); round 2 5/8 pass (http-api, cli, surface, events + earlier), 3 revise; round 3 5/8 `pass` (lifecycle, pricing, tools, events, surface), 3 `revise`: http-api (2 fragment cites on blank lines, `model.ts:8`/`:6`), cli (4 cross-module/absence scenario cites tagged confirmed), config (4 absence claims tagged confirmed). Remaining findings are the @fast generator repeating absence-tag non-compliance and rare wrong line numbers; hallucinated values reached 0 in round 3. `lint-cite` exit 0 before every audit round. Cross-cutting audit not run (capabilities not all passing). Package not promotable. Shortfall decision: see ask_user answer recorded in the follow-up row/notes. |
| 2026-10-04 | 2c (plain repo, after D1-D3 + tuning 1 + tuning 2 (generator STEP 7 cite self-check); 3 capability rounds + 3 cross-cutting rounds, final package) | `@fast` deepseek-v4.1-flash / `@research` opus-5.5; scripted merge as in 2/2b | 17/17 = 100% ✓ (R11 BR-035, I6 BR-045, I4 BR-079 all in `rules.md`) | 137/137 = 100% (120 extras) | 16/17 = 94.1% best match (15/17 worst duplicate) | ✗ QUIRK-001 + QUIRK-017 both match Q1 (cross-capability duplicate; scripted merge does not dedupe by meaning) | ✓ GAP-002/009 (dup); R9 main match BR-078 names literal `approval.autoApproveLimit` (BR-026/110/133 use `config.autoApproveLimit` only) | ✓ | ✓ | 22/22 PASS (23/23 incl. bin) | 10/10 | n/a (run 3 pending) | ~110 subagent calls for 2c alone (8 gen + 20 revise-gen, ~30 audits incl. cross-cutting x2, 1 completeness, 1 judge) | Capability audits: round 1 1/8 `pass` (cli), round 2 5/8, round 3 8/8 `pass` (lifecycle, http-api, surface re-audited; pricing/cli/tools/events/config carried from round 2 — their rendered ids were stable at 136/31/14 items). Cross-cutting audit: round 1 `revise` (7 items: 2 overgeneralised rules, 1 wrong `nullable`, 1 tag, 1 confidence, 2 cross-refs); round 2 `revise` after 4 capability revisions + re-audits (all 4 `pass`, http-api needed one split); round 3 `revise` with ONE item (`Request.params` model.md tagged confirmed, needs inferred). 3-round cap reached: package not promotable by the letter of the gate; residual is a single confidence tag, no hallucinated or missing behaviour. `lint-cite` exit 0 before every audit round (fragments, merged catalogs, completeness). Caveat: after the last http-api split the rule count moved 136→137, so five untouched capability specs were not re-audited against the shifted ids (refs resolve by construction of the merge). Hallucinated values per capability round: 1→0 (run 2 round 1: 4, round 3: 2; run 2c round 3: 0). M3 failure and duplicate-heavy catalogs are scripted-merge artefacts, not generator output. |
| 2026-10-04 | 3 (M5 re-run on the run-2c fixture copy, run 2c package supplied as previous; fragments regenerated, no audits — id carry-over only) | `@fast` / `@research` (id matching); merge = session script + one meaning-based id-matching pass by a `@research` subagent | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | M5 ✓ after matching: 155/156 surviving items kept their id on the first matched pass, 1 miss (BR-091 → BR-184) fixed; 0 new items reuse a previous id; 18 previous items merged into survivors (not failures), 8 dropped; QUIRK-008 narrowed (borderline). A first pass with lexical-similarity matching alone kept only 103/182 ids: id reuse needs meaning-based matching, not string similarity | ~25 subagent calls | Previous package frozen read-only, `seed-ids` raised the marks to 137/31/14, new ids allocated above them. |

Note (2026-10-04, review round 3, finding B1): runs 2b, 2c and the real-target run used the tuning-1 auditor wording "omitted supporting line = note, never `revise`". Review found it too permissive for a `confirmed` claim that quotes a literal. The shipped wording splits it: an omitted line NECESSARY to verify the exact claim → `confidence_errors` when tagged `confirmed`; omitted mere context → `notes`. The eval was not re-run with the final wording; expect equal or more `revise` verdicts on cite-completeness, never fewer grounded findings.

Judged case J1 (2026-10-04, review round 4, finding B1): auditor behaviour for omitted cite lines under the final check-3 wording. Setup: tiny package over `eval/fixture/src/orders.ts` with two `confirmed` claims. (N) "51 lines → TOO_MANY_LINES, message `an order must have fewer than 50 lines`" cited at `src/orders.ts:28` only; the guard (`:27`) and the constant behind the literal 50 (`:7`) are NECESSARY. (C) "createOrder stores the validated order under its id and returns it" cited at `src/orders.ts:52-55`; the neighbouring `parseOrder` line (`:51`) is mere context. Result: N → `confidence_errors` (`confirmed` → `inferred`, add lines 7 and 27), verdict `revise`; C → not reported (no `bad_citations`, no `confidence_errors`). One run, `@research` opus-5.5. The distinction holds.

Judged case J1b (2026-10-04, review round 5, finding B1): same package as J1 with claim N lowered `confirmed` → `inferred` but the cite left at `src/orders.ts:28`. Result: reported in `bad_citations` ("an inferred claim must cite every link … cite 7, 27-28 and 52"), verdict `revise`; claim C (context-only omission) again not reported. So the omission has a verdict path at every confidence level: `confirmed` → `confidence_errors`, `inferred`/`assumed` → `bad_citations`, mere context → `notes`. One run, `@research` opus-5.5.
