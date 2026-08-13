# ab-context calibration run — 2026-08-06

Single-arm matched-pair calibration. Purpose: test the claim in `proposal.md`
that the `scripts/ab-context` battery is **cued**, scoring 80–100% kb-first
where the field scores 23–31%.

## Design

- Arm: main repo cwd only (the retrieval fix is not implemented, so it cannot be
  an arm).
- 5 subjects × 2 framings = 10 tasks, identical checks (`first_search_is_kb`,
  `tool_called: kb_search`).
  - `arch-*` — harness archetype template: *"Where is X and how is Y? Point me
    at the exact file(s)."*
  - `field-*` — the verbatim user message that triggered investigation in a real
    session, typos preserved.
- Subjects matched across framings, so only framing varies.
- N=3, pi default model, 30 runs, ~3.5 h, 20.3M tokens, **$20.47**.

## Result 1 — the cueing hypothesis is REFUTED

| check | archetype | field | Δ | p |
|---|---|---|---|---|
| `kb_first` | 100% (n=14) | 100% (n=15) | **0pp** | 1.0000 |
| `used_kb` | 93% (n=15) | 100% (n=15) | +7pp | 0.31 |

Field-framed prompts trigger kb-first exactly as often as archetype-framed ones.
Task framing is **not** the harness's validity gap. The proposal's claim that the
battery is "cued" is wrong and is corrected there.

## Result 2 — a larger validity gap, confirmed from raw transcripts

| behaviour | harness (this run) | field (session mining) |
|---|---|---|
| kb-first | **100%** | 23–31% |
| ran `rg`/`grep` after `kb_search` | **0%** (0/29) | 41.3% |
| iterated on kb (`kb_search`/`kb_get` again) | **83%** (24/29) | 36.5% |

The harness cannot reproduce the condition under which the doctrine fails.
`pi -p` starts a **cold, single-turn** session: the agent has no conversation
history, no files already in context, and no prior edits — so the tools are its
only route and it stays on kb. Real sessions are **warm and multi-turn**: the
agent frequently already knows the path and reaches for `grep` directly.

The gap is environmental, not lexical. No rewrite of `tasks.jsonl` fixes it;
the harness would need multi-turn fixtures that pre-load context.

## Result 3 — field prompts are harder, but not in the measured direction

Mean tool calls after the first `kb_search`: **7.4** (archetype) vs **14.5**
(field). Field framing nearly doubles the work without changing the adherence
checks at all — further evidence that `first_search_is_kb` is insensitive to
what actually differs between the two populations.

## Consequence for this change

- The **41.3% fall-through** figure in `proposal.md` is softened: in a warm
  session, grepping a known path is often *correct*, so that number is an upper
  bound on kb failure, not a measure of it. The retrieval findings are unaffected
  — 55.8% duplicate slots and the +45% R@10 dedup result are measured against
  the index, not against behaviour.
- `scripts/ab-context` remains **unable to gate this change**. Task 10.5 is
  amended: the follow-up is not "repoint at real queries" (tested, no effect) but
  "add multi-turn warm-context fixtures, or accept that behavioural validation is
  out of reach for this harness".
- Same blindness class as the eval metrics: `first_search_is_kb` passes whenever
  kb is called first and is structurally blind to everything after — exactly as
  P@1 is blind to redundancy. Both instruments measure the move that already
  works.

## Reproduce

The calibration battery is kept **alongside** the canonical July battery, which
is restored untouched (`tasks.jsonl`, `arms.json`, `runs/`, `rows.jsonl`).

```bash
cd scripts/ab-context
cp tasks.jsonl tasks.july.bak && cp arms.json arms.july.bak
cp tasks.calibration.jsonl tasks.jsonl && cp arms.calibration.json arms.json
N=3 TIMEOUT=420 ./run.sh
node extract.mjs runs/*.jsonl > rows.calibration.jsonl
node paired.mjs rows.calibration.jsonl
cp tasks.july.bak tasks.jsonl && cp arms.july.bak arms.json   # restore
```

Raw artifacts: `scripts/ab-context/runs-calibration/` (30 JSONL + stdout),
`rows.calibration.jsonl`, `paired-report.txt`, `paired.mjs` (the paired
analyser; `analyze.mjs` assumes two arms and cannot score a single-arm run).

## Known limits

- N=3 per cell. Powered for the ~60pp effect claimed, not for anything small.
  The `used_kb` +7pp is noise (p=0.31).
- One arm — this measures framing, not any context-injection change.
- 5 subjects, all drawn from sessions where an investigation actually happened;
  subjects where the agent never searched are absent by construction.
- The 30 runs wrote 30 new session transcripts into the same corpus used for the
  field statistics. Future mining should exclude
  `2026-08-06T03:0*`–`06:4*` to avoid feedback.
