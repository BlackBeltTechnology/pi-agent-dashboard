# Tasks

## 1. Skill scaffold

- [ ] 1.1 Create `.pi/skills/build-lora-dataset/SKILL.md` with triggers ("build a LoRA dataset", "export training data from my sessions") and an explicit note: on-demand only, never auto-triggered.
- [ ] 1.2 The skill opens with an `ask_user` batch for scope (projects / date range / models), quality threshold, mixture caps (per task-type, per-tool), and target context length.

## 2. Reuse distiller extraction

- [ ] 2.1 Drive the existing `readSession` → `buildTrajectory` → `segment` path; do NOT re-parse JSONL.
- [ ] 2.2 Import `scrub.ts` (from `add-automatic-session-kb-index`) as the mandatory scrub stage.

## 3. Segmentation

- [ ] 3.1 Emit per-assistant-turn examples with full prior context (system + preceding turns), capped at the chosen context length.
- [ ] 3.2 Drop (do not truncate) any example whose assistant TARGET would be cut by the length cap.

## 4. Quality filter (terminal-state success detector)

- [ ] 4.1 Reuse `episodeVerifiedGood` (Part 4.6): keep trajectories with a verified-good terminal state; keep error→same-tool→fix recovery episodes.
- [ ] 4.2 Drop error-at-terminal-with-no-recovery and correction-terminated tails.
- [ ] 4.3 Score complexity (tool-call count, recovery presence, reasoning depth); apply the operator's quality threshold.

## 5. Dedup

- [ ] 5.1 Exact normalized-hash pass.
- [ ] 5.2 MinHash/LSH near-duplicate pass over prompt+target.
- [ ] 5.3 Optional embedding + cosine pass (flag-gated; off by default for cost).
- [ ] 5.4 Report the dedup ratio.

## 6. Format (chat template + loss mask)

- [ ] 6.1 Emit `messages[]` in the base model's chat template (system/user/assistant/tool), native structured tool calls, capped `thinking` retained.
- [ ] 6.2 Attach a `loss_mask` that trains ONLY on assistant text + tool_calls; assert system/user/tool tokens are masked.
- [ ] 6.3 Make the chat template pluggable (the target base model's tokens are model-specific).

## 7. Split + eval harness

- [ ] 7.1 Split `train/val/test` BY SESSION (never by turn) to prevent context leakage.
- [ ] 7.2 Reserve a diverse test set spanning task types and projects; emit a small golden hand-check subset.
- [ ] 7.3 Emit a stats report: example counts, tool/task-type distribution, length histogram, dedup ratio, success-label counts.

## 8. Tests

- [ ] 8.1 `quality-filter.test.ts`: recovery episode kept; error-terminal-no-recovery dropped; correction-terminated tail dropped (reuses `episodeVerifiedGood` fixtures).
- [ ] 8.2 `loss-mask.test.ts`: only assistant tokens unmasked; a planted user/tool span is masked; assertion fails loudly if mask is wrong.
- [ ] 8.3 `split-by-session.test.ts`: no session id appears in two splits.
- [ ] 8.4 `dedup.test.ts`: exact + near-duplicate collapse; ratio reported.
- [ ] 8.5 `scrub-integration.test.ts`: a planted secret drops the example before it reaches the dataset.
- [ ] 8.6 `format.test.ts`: emitted `messages[]` round-trips against a fixture chat template.

## 9. Documentation

- [ ] 9.1 Delegate to a docs subagent (caveman style): a `docs/` note linking the skill to `docs/research/lora-dataset-from-pi-logs.md` Parts 1–6; `ctx_index` it.
- [ ] 9.2 Add the skill row to `.pi/skills/AGENTS.md` (source tree, direct edit).
- [ ] 9.3 SKILL.md documents the output schema (`messages[]` + `loss_mask`) and the train/val/test layout for an external trainer.
