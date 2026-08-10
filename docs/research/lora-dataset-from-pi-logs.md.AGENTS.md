# research/lora-dataset-from-pi-logs.md — index

Research doc. Turns repo pi session JSONL logs into SFT dataset for LoRA adaptation of ~1T-param base model; target general instruction-following / agentic chat. Covers principles, pipeline-vs-real-log schema, LoRA formatting decisions, tradeoff tables, pitfalls. Organized Parts 1–9. Research basis for openspec changes `add-lora-dataset-export-skill` (Parts 1–6) + `add-automatic-session-kb-index` (Parts 7–9). Moved from root `research/` into `docs/research/` (consolidation).
