# DOX — scripts/ab-context

A/B behavior harness measuring whether trimming per-turn context injections (root `AGENTS.md`, tool schemas) changes agent behavior — framed as a non-inferiority test (arm B trimmed vs arm A full). Driven by the global `ab-test-context-injections` skill. Runtime outputs (`runs/`, `rows.jsonl`, `report.txt`, `*.log`) are gitignored via the local `.gitignore`. One row per tracked source file.

| File | Purpose |
|------|---------|
| `README.md` | Harness guide. Why non-inferiority (not significance), the pieces table, quick-start, margin `δ` framing, powering N. |
| `arms.json` | Arm map `{ "A": "<cwd>", "B": "<cwd>" }` — each arm points at a git worktree whose ONLY diff is the injected context. |
| `tasks.jsonl` | Eval battery. One JSON object per line `{ id, prompt, checks[] }`; checks target exactly the doctrine rules moved in arm B (kb-before-grep, rebuild-matrix, doc-protocol, ask_user). |
| `run.sh` | For each arm × task × N: runs `pi -p <prompt>` headless (serialized, unambiguous file-diff capture), writes each new session JSONL into `runs/`. |
| `extract.mjs` | Parse one run's JSONL → behavior row (tool sequence, adherence checks, token usage). |
| `analyze.mjs` | Aggregate rows → per-check pass-rate per arm, non-inferiority verdict, token delta + CI. |
| `judge.mjs` | Optional blind LLM judge: scores each transcript 1–5 on doctrine + quality via `pi -p`. |
| `finish.sh` | Wait for `run.sh` to drain, then pipe `extract.mjs runs/*.jsonl` → `rows.jsonl` → `analyze.mjs` → `report.txt`. |
