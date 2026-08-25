# Hermes Agent → pi-dashboard: Feature Adaptation Report

Research artifact. Explore-mode output. No OpenSpec change, no implementation. Source: https://github.com/NousResearch/hermes-agent + https://hermes-agent.nousresearch.com/docs/ (fetched 2026-08-20). Pickup-ready.

## Framing

Hermes Agent = Python CLI + messaging gateway. By Nous Research. MIT. Positioning: self-improving agent, closed learning loop, "lives where you do".

Not a dashboard. Compare capability surface, not architecture. pi-dashboard = control plane over pi sessions. Hermes = the agent itself.

Overlap = features, not layering.

## Overlaps — already covered, low marginal value

| Hermes feature | pi-dashboard equivalent |
|---|---|
| Cron scheduler | `automation-plugin` (cron triggers, triage inbox, run store, visibility) |
| Skills, progressive disclosure, agentskills.io standard | pi skills + `skill_manage`; ~15 skill packages under `packages/` |
| Persistent memory `MEMORY.md` / `USER.md` | `pi-hermes-memory` ext + `hermes-memory-plugin` settings surface |
| FTS5 session search | `session_search`, `kb_search`, `recall`, context-mode FTS5 |
| MCP integration | `mcp-server-plugin`, `pi-mcp-adapter` |
| Subagents / delegation / parallel workstreams | `subagents-plugin`, `flows-plugin`, git worktrees |
| Python-RPC zero-context-cost turns | `ctx_execute` / `ctx_batch_execute` |
| `hermes doctor` | `doctor` skill |
| Container isolation | `docker/` all-in-one harness |
| Multi-provider models, `hermes model` | `roles-plugin` + pi provider registry |
| Trajectory mining (ShareGPT export) | `distill-session-knowledge`, session JSONL |

## Tier 1 — High value, strong fit

| # | Hermes feature | What it does | pi-dashboard adaptation | Vector | Overlap today |
|---|---|---|---|---|---|
| 01 | Dangerous-command approval | Approval modes ask/yolo. Hardline blocklist floor. `approvals.deny` user rules. Approval timeout. Permanent allowlist. `hermes approvals suggest` mines history → proposes rules. Approve/deny over chat | Approval card in session stream + push to phone. Blocklist floor server-side | Server + UI + protocol | None. Largest gap. Remote-steered session runs destructive cmd unattended |
| 02 | Skills Hub + trust tiers | `hermes skills install owner/repo/skills/x`. Taps = GitHub repos as registries. Security scan on install. Third-party warning panel. `community` default vs `TRUSTED_REPOS` | Skill/plugin marketplace view over existing package install queue + plugin registry | UI + server | Partial: package-queue + plugin-registry exist. No discovery surface. Repo publishes ~15 skill packages, undiscoverable |
| 03 | Messaging gateway | Telegram/Discord/Slack/WhatsApp/Signal/Email from one gateway process. Voice-memo transcription. Cross-platform conversation continuity. Remote approve/deny replies | Generalized chat-gateway. Pairs with 01 for remote approval | Server + ext | Partial: `chat-gateway-exploration.md` (repo root) explore-only, Hermes cited as reference. Approval-over-chat angle raises value above plain relay |

## Tier 2 — Good fit, medium effort

| # | Hermes feature | What it does | pi-dashboard adaptation | Vector | Overlap today |
|---|---|---|---|---|---|
| 04 | Closed learning loop | Autonomous skill creation after complex tasks. Skills self-improve during use (skill file patched when procedure proves wrong) | Surface "agent proposed new skill / skill edit" as reviewable card, not silent write | UI + skill | Partial: `skill_manage` manual; `distill-session-knowledge` offline |
| 05 | Memory nudges + capacity mgmt | Bounded stores `memory_char_limit: 2200`, `user_char_limit: 1375`. Periodic nudge to persist/prune. `write_approval` flag | Memory browser/curator UI + capacity meter | UI | Partial: `consolidate-pi-memory-store` skill = manual version. Converges with oh-my-pi #13 Hindsight |
| 06 | `/insights [--days N]` | Cross-session usage analytics, token spend, patterns | Analytics view over session store | UI + server | Partial: `context-usage.ts` per-session only. context-mode Insight adjacent |
| 07 | Context-file injection scanning | Scans AGENTS.md / `.cursorrules` / SOUL.md pre-injection: "ignore prior instructions", hidden HTML comments, `.env`/`.netrc` reads, curl exfil, zero-width + bidi Unicode. Blocks + warns. Also scans cron prompts at create/update. MCP subprocess env credential filtering | Scan AGENTS.md before load. Scan automation prompts on write. Filter MCP env | Server + ext | None. Repo loads AGENTS.md every turn from arbitrary opened projects |
| 08 | Failure-streak nudge | Per-job `failure_streak`. At `cron.failure_nudge_threshold: 3` message suggests fix/pause/remove. Success resets. One-shot jobs exempt | Add to `automation-plugin` triage inbox | Plugin | None. ~30 LOC |

## Tier 3 — Architecture / protocol ideas

| # | Hermes feature | What it does | pi-dashboard adaptation | Vector | Overlap today |
|---|---|---|---|---|---|
| 09 | Pluggable terminal backends | 7 backends: local, docker, ssh, singularity, modal, daytona, vercel_sandbox. `terminal.backend` config. Daytona/Modal hibernate when idle | Per-session execution target. Decouple "where dashboard runs" from "where agent works" | Server + protocol | None. Big lift |
| 10 | External memory-provider interface | 8 swappable backends: Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory. `hermes memory setup` / `memory status`. Run alongside built-in, never replace | Steal the contract: swappable memory backends behind one tool schema | Protocol | None |
| 11 | Personalities | `/personality <name>`, SOUL.md persona file | Persona switcher per session | UI | Partial: roles-plugin adjacent. Mostly cosmetic |
| 12 | `/retry` `/undo` `/compress` | Turn-level rewind + explicit context compression | `/undo` = the useful one | Needs pi-core support | None |
| 13 | Tool Gateway | Nous Portal proxies model + web search (Firecrawl) + image gen (FAL) + TTS (OpenAI) + cloud browser (Browser Use) under one sub. Per-backend, not all-or-nothing | Credential-broker pattern for dashboard-managed tool keys | Server | None |

## Recommended shortlist

1. Command-approval gate + dashboard approval cards — security floor + remote HITL
2. Context-file prompt-injection scanner — cheap, matches AGENTS.md-everywhere design
3. Skills/plugin hub UI with trust tiers — supply exists, discovery does not
4. Automation failure-streak nudge — trivial, immediate
5. Memory curation UI + nudges — converges with oh-my-pi #13; do once

Closing note: items 1 and 5 surfaced independently in `docs/research/oh-my-pi-feature-adaptation.md`. Convergence = signal.
