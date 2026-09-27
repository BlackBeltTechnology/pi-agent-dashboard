# DOX — packages/untrusted-content-guard/src

Files in this directory. One row per source file. See change: add-untrusted-content-guard.

| File | Purpose |
|------|---------|
| `extension.ts` | Pi entry. Wires `UntrustedContentGuard` to `session_start` (`loadSettings(ctx.cwd, ctx.isProjectTrusted())`), `before_agent_start`, `agent_start`, `input`, `message_end`, `tool_result`, `tool_call`; registers `/guard-clear`. No dashboard dependency. |
| `glob.ts` | `matchesAny(name, patterns)` — anchored tool-name glob (`*`, `?`); regex cache. |
| `guard.ts` | `UntrustedContentGuard` core, pi-independent. Selection (glob / registry `untrusted` / `details.untrusted===true`). `onToolResult`: `scan` per text block, `escapeDelimiters`, spotlight open/close + `summaryLine`; block mode → `blockNotice`; taints. `onMessageEnd`: taints on untrusted-by-name `toolCall` before execution (parallel-safe). `onToolCall`: tainted + sensitive + not `selfConfirming` → `ctx.ui.confirm` (reject/false = deny) or headless block; reason prefix `TAINT_REASON` = `untrusted_taint`; any internal throw → block (fail-safe). `onInput` resets in `run` scope only; `onAgentStart` renews marker, keeps taint. |
| `registry.ts` | D6 registry. `REGISTRY_SYMBOL` = `Symbol.for("pi.untrusted-content-guard")`; `getRegistry(host?)` create-or-adopt `{declarations:[]}`; `isDeclared(reg,kind,name)` live read, glob names, malformed entries ignored. Never fed from tool input/results. |
| `settings.ts` | `resolveSettings(...layers)` pure field-wise merge onto `DEFAULT_SETTINGS` (D5 defaults); invalid fields dropped; `preset:"strict"` adds `write`/`edit` + `taintScope:"session"` unless explicit. `loadSettings(cwd, projectTrusted)` reads `SETTINGS_KEY` from `$PI_CODING_AGENT_DIR\|~/.pi/agent/settings.json` then `<cwd>/.pi/settings.json` (trusted projects only). |
| `spotlight.ts` | D4 format. `GUIDELINE`, `newMarker()` (8-char base62), `escapeDelimiters` (`<<` → `< <` before `untrusted`), `openDelimiter`/`closeDelimiter`, `summaryLine(findings, mode)` (`[guard] N hidden span(s) removed (…)`; meta findings + low list), `blockNotice` (layers + counts, never samples — a sample is the payload). |
