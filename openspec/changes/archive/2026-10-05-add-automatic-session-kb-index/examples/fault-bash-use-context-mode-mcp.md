---
kb:
  signal: fault
  signature: fault:bash:use-context-mode-mcp-too
  seen: 154
  sessionIds: [019de05f, 019de0b5, 019de0d5, 019de0d6]   # +150 more (truncated)
  cwd: <repo>
  model: claude-opus-4-7
  confidence: 0.999
  verified: true
  firstSeen: 2026-05-xx
  lastSeen: 2026-07-13
  tags: [bash, context-mode, mcp, large-output, hook, tool-routing]
---
# Bash blocked: route large-output commands through context-mode MCP tools

## Symptom
A `bash` call is intercepted by the context-mode PreToolUse hook with guidance to use
an MCP tool instead. Most recurring fault in the corpus — 154 sessions.

## Root cause
context-mode routes commands whose output may exceed ~20 lines away from `bash` (whose
full stdout enters conversation memory) toward sandboxed tools (`ctx_execute`,
`ctx_execute_file`, `ctx_batch_execute`) that process bytes out-of-context and return
only a printed summary. A raw `bash` on log scans / test runs / repo-wide greps trips
the guard.

## Fix
- For "derive an answer FROM data" (filter, count, parse, aggregate, scan logs), use
  `ctx_execute` / `ctx_execute_file` and `console.log` only the summary.
- Keep `bash` for single short observational commands (`git status`, `ls`, a one-line
  read) and for mutations/navigation (Edit/Write/cd) — those are not the target.
- Batch 3+ related I/O commands via `ctx_batch_execute` instead of sequential `bash`.

## Verification
The command runs via the MCP tool; only the intended summary lands in context; the
PreToolUse guard does not fire.

## Provenance
sessions 019de05f, 019de0b5, 019de0d5, 019de0d6 (+150 more); seen 154×;
distilled by claude-opus-4-7 on 2026-07-13; confidence 0.999.
