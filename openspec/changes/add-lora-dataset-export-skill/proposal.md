# On-demand skill to export a LoRA training dataset from pi session logs

> Research basis: `docs/research/lora-dataset-from-pi-logs.md` Parts 1–6 (pipeline), 4.6
> (success detector), and Part 9 (this is the **on-demand** downstream, deliberately
> NOT automatic). Depends on `add-automatic-session-kb-index` for the shared scrub.

## Why

Fine-tuning a large base model with LoRA is worth it when you want the model to *behave*
differently by default (agentic tool fluency, house style) rather than just *recall*
facts (which the automatic KB index already covers). The raw material — pi session JSONL
— is agentic-trajectory data, not Q&A, and turning it into a good LoRA set requires
deliberate judgment: which sessions, what quality bar, what mixture, correct loss
masking, and a session-level train/test split. That judgment is exactly why this path is
**on-demand** (a skill/subagent a human invokes before a training run), not an automatic
background job that would burn effort on a dataset nobody asked for.

Today no such export exists. The `session-distiller` produces verified artifacts but has
no path that emits a chat-templated, loss-masked, deduplicated SFT dataset.

## What Changes

- **New skill `build-lora-dataset`** (with an optional subagent for the fan-out work)
  that wraps the Part 3–4 pipeline over pi session logs. Invoked deliberately; never
  auto-triggered.
- **Reuse, don't rebuild**: the skill drives the existing `session-distiller`
  `Trajectory`/`Episode` machinery and the shared `scrub.ts` (from
  `add-automatic-session-kb-index`).
- **Pipeline stages** (research doc Part 3): segment (per-assistant-turn window with
  full prior context, capped at context length) → scrub (mandatory) → quality-filter →
  dedup (exact hash → MinHash/LSH → optional embedding) → format (chat template + loss
  mask) → split-by-session.
- **Quality filter = the terminal-state success detector** (Part 4.6): reuse
  `episodeVerifiedGood` — keep trajectories whose terminal state is verified-good (tool
  `isError === false` / passing check / non-correction next user turn); keep
  error→same-tool→fix *recovery* episodes; drop error-at-terminal-with-no-recovery and
  correction-terminated tails.
- **Loss masking**: emit `messages[]` in the base model's chat template with a
  `loss_mask` that trains ONLY on assistant text + tool calls; system/user/tool tokens
  masked.
- **Choices surfaced, not defaulted**: the skill asks the operator for scope (projects /
  date range / models), quality threshold, mixture caps (per task-type / per-tool), and
  target context length — these are decisions, not silent defaults.
- **Output**: a JSONL dataset file plus a `train/val/test` split **by session** (never by
  turn), and a small stats report (counts, tool/task-type distribution, dedup ratio).

## Capabilities

### Added Capabilities

- `lora-dataset-export`: an on-demand, operator-driven export that turns verified pi
  session trajectories into a scrubbed, quality-filtered, deduplicated, chat-templated,
  loss-masked SFT dataset with a session-level train/test split.

## Impact

- **Scope**: a new skill under `.pi/skills/build-lora-dataset/` + a thin export module in
  `packages/session-distiller` (format/loss-mask/split; reusing extraction, `scrub.ts`,
  and `episodeVerifiedGood`). ~300–400 LOC + tests. No server, no GPU, no training code —
  this produces a dataset file only.
- **Invocation**: manual. The skill triggers on "build a LoRA dataset", "export training
  data from my sessions", etc. It is explicitly NOT wired to any lifecycle trigger.
- **Data safety**: same mandatory scrub gate as the automatic path; a failed secret scan
  drops the example.
- **User-visible**: an operator runs the skill, answers the scope/quality/mixture
  questions, and gets a dataset file + stats report ready for an external LoRA trainer.
- **Out of scope**: the training run itself (external, GPU); hyperparameter tuning; the
  automatic KB index (separate change).
- **Sequencing**: depends on `add-automatic-session-kb-index` for `scrub.ts`. Both read
  the same verified artifacts from the same distiller — one upstream, two invocation
  models (research doc Part 9).

## Discipline Skills

- `security-hardening` — the export scrubs secrets/PII from untrusted session content;
  the scrub gate must drop any example that fails the secret scan before it reaches a
  dataset that may be shared with a trainer.
- `performance-optimization` — dedup (MinHash/LSH, optional embedding) and segmentation
  run over a large corpus (≈842 MB); the pipeline must stay tractable and streaming.
