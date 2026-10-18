## ADDED Requirements

### Requirement: pi 1.2.0–1.3.0 changes SHALL be recorded as adopted, not consumed, or no-ops

The adoption record SHALL list:
- **Adopted:** the floor raise to 1.3.0 (`pi-core-version-check`); Retry turns receive `before_agent_start` contributions, including the team-guard skill filter (`agent-session-context-injection`); single-bang output sent with `deliverAs: "followUp"` (`command-routing`); the follow-up drain on `agent_settled` (`mid-turn-prompt-queue`); `sessionShareDestination` (`pi-agent-settings-editor`).
- **Audited, not consumed:** `before_agent_start.messageType` (no dashboard handler reads `prompt`); pi's published JSON Schemas for settings, models, keybindings and themes (not in pi's `exports`; deriving `pi-settings-schema.ts` from them is a separate change); `reachesTools` and namespace `aliases` (no dashboard tool reaches other tools); `PI_CLIPBOARD_OSC52` (a pi process environment variable).
- **Documented no-ops**, each with its reason:
  - `enabledModels` / `--models` scope resolution (1.3.0): pi now resolves an exact model reference first and keeps every provider for an ambiguous bare id, with a warning (`dist/core/model-resolver.js` `resolveModelScope`). The dashboard mirror (`packages/shared/src/enabled-models-match.ts`, minimatch on `provider/id` and bare `id`) already counts every provider, so the two now agree more closely. The remaining difference (ids that minimatch reads as globs, e.g. `[1m]`) also existed in 1.1.0 and is left for a follow-up.
  - Changelog-sourced, not code-verified (marked `unverified` in `evidence.md`): the provider fixes listed below and the #10267 section-retention fix.
  - Fixed inside pi: dropping a previous model's thinking on model switch; additional transient-error retry patterns (the dashboard reads pi's retry events instead of replicating the classifier); malformed tool-call JSON validation and invalid `\u` escapes; the symlinked `AGENTS.md` in a nested worktree; `~` expansion in resource-filter settings; the `ctx.ui.custom` overlay `done()` fix; codemode worker limits and timings; provider fixes (OpenCode, Gemini/Vertex, Xiaomi MiMo, Mistral stream timeout, Anthropic error-tool-result images, OpenRouter placeholder prices); the GPT-6 thinking-level cache preservation; per-key OpenRouter model lists (registry-derived).
  - Resumed sessions keep their active tools: the `context-budget` meter's `session_start` filter now applies over the restored set.
  - `pi mcp list --json` reports `resources: true` instead of counts: `mcp-client-plugin` reads neither field.
  - pi's MCP config rules that `mcp-client-plugin/src/core/pi-rules.ts` mirrors (`dist/core/mcp-servers.js`, `dist/extensions/mcp/config.js`) are byte-identical in 1.1.0 and 1.3.0, so the mirror needs no change. The `pi mcp login --timeout` help-text fix is CLI-only.
  - Print mode exits 1 on a truncated final response: the `memory-eval` judge already treats a non-zero exit as a failed judgement.
  - TUI only: the `showHardwareCursor` drawing change (key, type and default unchanged), shifted-symbol keybindings, overlay mouse-wheel scrolling, and terminal colour-reply leaks.
  - Not used by the dashboard: the theme `$schema` move, the removed experimental `pi-client`/`pi-protocol`/`pi-server` packages, the dropped `./client` and `./experimental/plugin` exports, and the `@earendil-works/chord` dependency. A repo-wide search finds no import of any of them; `chord` appears only in `pnpm-workspace.yaml` and the lockfile, which the bump regenerates.
  - Changed in pi, no dashboard writer: `kimi-coding` uses Chat Completions at `api.kimi.com/coding/v1`, and `models.json` base-URL overrides must include `/v1`. The dashboard writes none, and `quota-plugin` calls Kimi's usage API directly.

#### Scenario: Audit list is present
- **WHEN** the change is archived
- **THEN** the feature-detection spec SHALL name each listed item with its classification and reason
