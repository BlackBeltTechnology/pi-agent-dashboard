## ADDED Requirements

### Requirement: pi 1.0.1–1.1.0 changes SHALL be recorded as adopted, not consumed, or no-ops

The adoption record SHALL list:
- **Adopted:** `samplingParamsByThinkingLevel` passthrough (this capability); `tool_execution_end.durationMs` (`event-reducer`); the `azure-openai-responses` → `azure` rename (`provider-auth-server`, `provider-auth-ui`); `--no-mcp` (`plugin-spawn-scope`, change `spawn-scope-no-mcp`); MCP project overrides (`mcp-client-config`, change `mcp-client-project-overrides`).
- **Forwarded, not consumed:** `agent_settled.aborted`. Unread and push fire on the `agent_end` status edge before the settle, and a user abort is already visible through `stopReason: "aborted"` and the retry-cancel tombstone. The bridge SHALL forward the field unchanged.
- **Documented no-ops**, each with its reason:
  - TUI only: `registerToolRenderer`, `outputPad`, the tool render-context `durationMs`, OSC 7501 program status (dashboard sessions are headless, or under tmux, which doesn't forward it), the `Home`/`End` keys, and fullscreen selection fixes.
  - The dashboard keeps explicit allowlists: `--tools` `+name`/`-name` and `*` patterns.
  - Model registry-derived: Claude Haiku 5.5, GPT-6 Luna, llama.cpp decision models and Cloudflare Clef classifiers.
  - Inside pi: the Nix flake, the Radius org-disabled model filter, MCP OAuth hardening, CIMD and `/mcp` live updates, the retry additions (`server_busy`, Mistral `finish_reason: "error"`, Bedrock stream stalls; pi-ai classifies them and the dashboard reads pi's retry events instead of replicating the classifier), codemode output separators and image persistence, the 3.5 chars/token context estimate, and the pricing-tier fixes.
  - Covered by the repo's own pinning: the removal of npm shrinkwrap (resolution is pinned by `pnpm-workspace.yaml` overrides and the runtime lock).
  - Out of scope for this change: managed-installer `pi update` retention; managed-install discovery is a separate spike.
  - Handled by a dependency change: the 1.0.4 `--tools` behaviour change (an allowlist keeps MCP tools), in `spawn-scope-no-mcp`.

#### Scenario: Audit list is present
- **WHEN** the change is archived
- **THEN** the feature-detection spec SHALL name each listed item with its classification and reason

#### Scenario: aborted is forwarded unchanged
- **WHEN** pi emits `agent_settled` with `aborted: true`
- **THEN** the forwarded dashboard event SHALL carry `aborted: true`, and session status SHALL resolve exactly as for `aborted: false`

### Requirement: Per-thinking-level sampling parameters SHALL pass through model re-registration

When the bridge re-registers a `models.json` model with its native metadata, it SHALL carry the entry's `samplingParamsByThinkingLevel` (pi ≥ 1.0.2) unchanged, as it carries `samplingParams`. The field SHALL be omitted when the native entry declares none, and SHALL NOT be validated or rewritten by the dashboard. The server's internal registry SHALL carry it the same way.

#### Scenario: Per-level sampling survives re-registration
- **WHEN** a `models.json` model declares `samplingParamsByThinkingLevel: { "high": { "temperature": 0.2 } }`
- **THEN** the model the bridge registers SHALL carry the identical `samplingParamsByThinkingLevel` value

#### Scenario: Absent field stays absent
- **WHEN** a `models.json` model declares no `samplingParamsByThinkingLevel`
- **THEN** the registered model SHALL have no `samplingParamsByThinkingLevel` key
