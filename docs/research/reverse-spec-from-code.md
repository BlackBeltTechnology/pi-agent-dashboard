# Reverse-spec prompt tuning — results

Records `reverse-spec-from-code` skill prompt tuning + generator-model-loss experiment. Raw per-capability generated specs live in gitignored `.reverse-spec-scratch/`. Skill lives at `packages/openspec-workflow/.pi/skills/reverse-spec-from-code/`.

Ground truth: 6 real openspec/specs. Generators ran BLIND (code only). Judge scored gen-vs-real semantically (granularity-neutral, stale-spec-aware).

## Scores (requirement coverage / scenario coverage)
| capability | v1 req | v1 scen | v2 req | v2 scen |
|---|---|---|---|---|
| server-cors | 72 | 80 | 96 | 92 |
| server-restart | 40 | 30 | 95 | 85 |
| token-stats-bar | 65 | 55 | 92 | 85 |
| jiti-loader | 72 | 55 | 100 | 100 |
| ws-ping-pong | 90 | 78 | 100 | 95 |
| force-kill-handler | 62 | 55 | 100 | 88 |
| average | 66.8 | 58.8 | 97.2 | 90.8 |

## What changed v1->v2 (prompt levers)
1. Cross-boundary exploration (STEP 1): follow every emitted message / registry write / spawned process / config read into the OTHER file and spec it. Dominant lever (server-restart 40->95).
2. Group into 3-8 requirements with multiple scenarios; stop over-splitting.
3. Add `# <cap> Specification` title header.
4. "Describe CURRENT code, do not soften to older assumptions" — real specs drift from code; a more code-accurate generated spec is a WIN not a miss.

## Residual (folded into shipped prompt v3)
- token-stats-bar invented a 4-color stacked bar not in code -> rule: do not describe visual/detail specifics not confirmed in code.

## Key insight for fitness
"Match the real spec" = PROXY not goal. Real specs go stale. Goal = spec that accurately describes CURRENT code and is kb_search-able. Target high requirement coverage + zero code-ungrounded hallucination, accepting code-current divergence from stale specs.

## Model-size loss test (generator model swap; judge held constant @research)
Same 6 ground-truth specs, same v2/v3 prompts, same scope. ONLY GENERATOR model changed. Judge = @research (opus) for all, so comparison clean.
| capability | opus req | haiku req | opus scen | haiku scen | haiku format | haiku validate |
|---|---|---|---|---|---|---|
| server-cors | 96 | 90 | 92 | 92 | 98 | PASS |
| server-restart | 95 | 95 | 85 | 85 | 90 | (pass) |
| token-stats-bar | 92 | 90 | 85 | 85 | 20 | FAIL |
| jiti-loader | 100 | 90 | 100 | 75 | 30 | FAIL |
| ws-ping-pong | 100 | 95 | 95 | 90 | 80 | (pass) |
| force-kill-handler | 100 | 68 | 88 | 60 | 55 | FAIL |
| average | 97.2 | 88.0 | 90.8 | 81.2 | 62.2 | 3/6 pass |

Loss opus @research -> haiku @compact: req 97.2->88.0 (-9.2 pts); scen 90.8->81.2 (-9.6 pts); openspec validate 6/6->3/6 (format collapse dominant).

Where loss concentrates:
1. FORMAT big drop — haiku invents markdown TABLES, bold `**Scenario:**` instead of `#### Scenario:`, numbered `### Requirement N:`; 3/6 fail openspec validate; semantic content fine, STRUCTURE breaks.
2. HARDEST cross-cutting cap degrades most: force-kill 100->68 req; haiku missed PID-correlation / pre-SIGKILL safety-check / no-direct-kill (needs 3-4 files); single-file caps hold ~90+.
3. Hallucinations rise ~0 -> a few (token-stats continuous-gradient vs discrete thresholds; force-kill durable liveness marker).

## Third data point: @fast = deepseek-v4-flash (generator), judge held @research
| capability | flash req | flash scen | flash format | flash validate |
|---|---|---|---|---|
| server-cors | 100 | 100 | 100 | PASS |
| server-restart | 100 | 100 | 95 | PASS |
| token-stats-bar | 80 | 72 | 95 | PASS |
| jiti-loader | 95 | 90 | 98 | PASS |
| ws-ping-pong | 100 | 92 | 90 | PASS |
| force-kill-handler | 100 | 88 | 96 | PASS |
| average | 95.8 | 90.3 | 95.7 | 6/6 pass |

## Full loss curve (generator swapped; judge constant @research)
| generator model | req cov | scen cov | validate | hallucinations |
|---|---|---|---|---|
| opus (@research) | 97.2 | 90.8 | 6/6 | ~0 |
| deepseek-v4-flash (@fast) | 95.8 | 90.3 | 6/6* | 3 (minor) |
| haiku-4.5 (@compact) | 88.0 | 81.2 | 3/6 | 3 (minor) |

CAVEAT/CONFOUND: @fast prompts added ONE explicit format directive ("use `#### Scenario:` headings, not bold, not a table") that @compact prompts lacked. Format gap (95.7 vs 62.2) PARTLY prompt not pure model — key mitigation finding: one-line format directive takes cheap model from 3/6 to 6/6 valid.

## Corrected takeaways
1. "fast" != "small/weak". deepseek-v4-flash nearly matches opus on semantic coverage (95.8 vs 97.2 req). Real capability floor shows on haiku-4.5 (88.0 req; hardest cross-cutting spec force-kill collapsed to 68).
2. Format compliance CHEAP to recover: explicit heading directive fixed it even on fast model (6/6 valid). Bake directive into generator prompt regardless of model.
3. Cheaper generators still hallucinate a little (jiti tsx-loader contradiction; force-kill WS-close ordering). Keep @research auditor + `openspec validate` gate + revise loop; catches both.
4. Practical config: @fast generator + format directive + validate gate + @research auditor/revise ~= opus quality at fraction of cost.

## Large / complex scenario test (generator swap; judge constant @research)
Extends the small-6 baseline (1-7 reqs each) to large capabilities. Same blind-generate + judge harness. Judge = @research for all.

| target | real size | opus req | opus scen | flash req | flash scen | opus-flash req gap | format (both) |
|---|---|---|---|---|---|---|---|
| small-6 baseline | 1-7 reqs | 97.2 | 90.8 | 95.8 | 90.3 | ~1 | ~96 |
| event-reducer | 20 reqs, one 2003-line file | 85 | 68 | 80 | 55 | 5 | 96 |
| model-proxy | 15 reqs, ~18-file subsystem | 62 | 55 | 67 | 58 | ~0 | 96 |
| dashboard-plugin-loader | 53 reqs, whole product | 72 | 66 | 50 | 46 | 22 | 96 |

### Findings
1. Coverage degrades with size. ~97% (small) -> 50-85% (large). Bigger capability = lower single-pass coverage.
2. Cheap-model gap WIDENS with complexity. Small ~1 pt; event-reducer 5 pts; 53-req giant 22 pts (opus 72 vs flash 50). Flash saturates ONE slice (server loader ~50%), leaves client-runtime / REST / bridge / UI unrepresented; opus spreads across the surface. Cheap models cover one slice deep; strong models spread.
3. Two large-spec failure modes:
   - Scenario-depth collapse (event-reducer, one big file): requirement BREADTH holds (~85%), but 77 fine-grained edge-case scenarios (reorder races, boundary clamps) compress to a few happy-path each. Breadth survives, depth does not.
   - Under-scoped product surface (model-proxy, giant): a large capability spans server engine + routes + config + client UI + bridge. File list = engine dir only -> both models miss the same host-integration reqs REGARDLESS of model. Ceiling set by discovery's file gathering, not the generator. model-proxy flash 67 ~= opus 62 proves it.
4. Format + grounding hold at every scale. 96% format compliance, ZERO hallucinations, both models, all sizes. Format directive + validate gate + code-oracle discipline do not degrade with complexity. Both models add finer code-grounded detail than the stale real specs.
5. Validates the skill design. Giant monolithic specs (1312-line loader spec = one delta across two changes) are exactly what conservative discovery decomposes into bounded sub-capabilities. Reverse-gen at bounded granularity (~90-95% each) beats one blind pass at a 53-req monolith (50-72%). Decomposition is the mitigation.

### Practical guidance (large capabilities)
- Split, do not monolith. Let discovery decompose a giant into sub-capabilities; spec each. Higher aggregate coverage than one giant pass.
- Scope completeness sets the ceiling. Product-level capability -> discovery gathers ALL layers (server + routes + client + bridge), else whole requirement clusters missed.
- Use opus / @research for large cross-cutting capabilities; reserve @fast for bounded single-file ones. Model gap bites only at scale.
