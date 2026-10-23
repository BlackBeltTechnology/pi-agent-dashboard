# Scenario-design gap decisions — harden-git-terminal-plugin-boundaries

Hard-gate answers for the spec gaps scenario-design surfaced (stage: design).
Each line: gap → chosen answer (letter refers to the candidate list in the
drafting output). Principle: fail closed, match existing behaviour, prefer the
simpler mechanism. Answers that change a spec are applied to the deltas before
the test plan is folded.

## Server (B20, B1r, R1, S1r, B15r)

- S-G1 control characters → C0 `0x00–0x1F` + DEL `0x7F`.
- S-G2 masked form → keep the prefix + `***` (e.g. `ghp_***`).
- S-G3 token bounds → prefix + ≥ 20 chars of `[A-Za-z0-9_-]` with a non-word boundary before the prefix.
- S-G4 repo root itself → `.`; `ssh://user:pass@` → password removed, user kept; scp form unchanged.
- S-G5 ref/path validation scope → every caller-supplied git ref or path, incl. orphan-cleanup, PR-worktree and worktree-remove paths.
- S-G6 redaction perf → p99 < 10 ms for 100 KB input, linear scaling asserted at 1 MB.
- S-G7 terminal precedence → admission first; cap re-checked after admit (`terminal_error` wins for a refused cwd).
- S-G8 non-string/empty/relative standalone cwd → `terminal_error{code:"cwd_not_admitted"}`.
- S-G9 inline session with no recorded cwd → `cwd_not_admitted`.
- S-G10 unexpected admission/spawn throw → `terminal_error{code:"cwd_admission_unavailable"}`.
- S-G11 requester disconnects during admission → spawn suppressed.
- S-G12 notice stacking → newer terminal notice replaces the older one.
- S-G13 refused flow id → 400 `invalid_flow_id`.
- S-G14 non-string cwd on plugin routes → 400 `invalid_cwd`.
- S-G15 folder-scope contributions lifetime → read per request (disabled contributor stops being admitted immediately).
- S-G16 MCP tools requiring cwd → only folder-specific tools (create, update, delete, definition, runs, result).
- S-G17 automation allowlist breadth → provider's whole manifest `emits` (as designed; no runtime channel).
- S-G18 provider unloaded → its types leave the allowlist (computed live).
- S-G19 refused spoof `provide` → returns silently after logging.
- S-G20 `<source>` parsing → first segment after `automation.action.`; empty source → refused as malformed.
- S-G21 reserved-prefix emit → same once-per-(plugin, type) warning, naming the reserved prefix.
- S-G22 manifest `emits` limits → reject whitespace-bearing, empty, case-insensitive reserved-prefix entries; ≤ 64 entries, ≤ 128 chars each.
- S-G23 warning dedupe → capped at 1 000 (plugin, type) pairs, then one summary warning.
- S-G24 post-start plugin registration failure → logged and the plugin marked failed (server keeps running).

