# Tasks

## 1. Retire superseded change

- [x] 1.1 Add SUPERSEDED banner atop `openspec/changes/pi-log-miner-skill/proposal.md` pointing to `distill-session-knowledge`. → verify: banner present; old file otherwise unchanged.

## 2. Harvest (`session-trajectory-harvest`)

- [x] 2.1 Standalone JSONL reader: parse one session file → ordered events; tolerate malformed lines (skip + count). → verify: unit test over a fixture session returns expected event counts.
- [x] 2.2 Normalize into a trajectory model: turns with `{role, text?, thinking?, toolCalls[], toolResults[]}`, pairing `toolCall.id`↔`toolResult.toolCallId`. → verify: every toolCall pairs to its result (or flagged unpaired).
- [x] 2.3 Watermark store at `~/.pi/agent/distill-session-knowledge/<cwd-hash>/watermark.json`; read on start, list only sessions newer. → verify: second run with unchanged corpus processes 0 sessions.
- [x] 2.4 Segment trajectory into task episodes (new top-level user msg, `session_info.name` change, time gap > T, tool-cluster shift). → verify: fixture with 3 distinct tasks yields 3 episodes.

## 3. Verified-signal extraction (`verified-signal-extraction`)

- [x] 3.1 Fault/correction detector: `isError=true` → retry same tool → `isError=false`; emit {wrongCall, error, fixCall}. → verify: fixture flip detected; non-flipping error ignored.
- [x] 3.2 ask_user decision detector: `toolCall name=ask_user` + next `toolResult`; emit {question, answer}. → verify: 51-call corpus sample extracts Q/A pairs.
- [x] 3.3 User-correction detector: user msg after assistant action matching correction lexicon. → verify: precision check on labeled fixtures.
- [x] 3.4 Procedure detector: span >5 toolCalls, one episode, verified-good end. → verify: short spans rejected; long verified spans accepted.
- [x] 3.5 Verification anchor gate: drop any candidate without a verified-good terminal state. → verify: unverified spans excluded from output.

## 4. Cross-session distillation (`cross-session-distillation`)

- [x] 4.1 Cluster similar episodes across sessions (signature: tool sequence + error class + file/topic). → verify: same fault in 2 sessions clusters together.
- [x] 4.2 Recurrence gate: promote cluster only when seen in ≥ N sessions (default N=3); hold below-threshold clusters in candidates file, auto-promote when count reaches N. → verify: N=3 promotes 3-session cluster, holds 2-session cluster.
- [x] 4.3 Distill artifact per cluster (subagent, haiku-class): structured output + provenance {sessionIds, model, date, confidence}. Confidence-decay model: decays over time/model change, refreshed by fresh recurrence; below-floor → flagged stale for prune. → verify: artifact carries provenance; aged artifact without recurrence drops below floor.
- [x] 4.4 Dedup + route: query target sink before write (skill_manage view / memory_search / docs grep); merge or create. Routing: procedures→skill_manage; faults+corrections→memory(failure); ask_user decisions→project memory(convention); narratives→docs+ctx_index; rule-establishing corrections ALSO patch AGENTS.md via docs subagent (caveman style, ≤200 chars). → verify: re-running over same corpus creates 0 duplicates; a rule correction both writes memory and patches AGENTS.md.
- [x] 4.5 Dry-run default: emit routing plan without mutating sinks; `--apply` to write. → verify: dry-run mutates nothing; apply writes expected entries.

## 5. Skill packaging

- [x] 5.1 `.pi/skills/distill-session-knowledge/SKILL.md` with NL triggers + procedure (run miner, review dry-run plan, apply). → verify: skill loads; dry-run runs end-to-end on this project's sessions.
- [x] 5.2 `ctx_index` the doc-class outputs so they are FTS5-searchable. → verify: `ctx_search` returns a freshly distilled doc.

## 6. Docs

- [x] 6.1 Add file-index rows for new orchestrator files (delegate to docs subagent, caveman style). → verify: rows present in matching `docs/file-index-*.md`, path-alphabetical.
