## Why

Rule-based repair (`add-mermaid-auto-repair`) fixes the known mechanical failure classes, but a residue stays broken: wrong arrow syntax for the diagram kind, unbalanced flowchart `subgraph`/`end`, duplicate ids with conflicting shapes, half-invented syntax. A model fixes these reliably given the source and the parser error. The user should be able to ask for that fix with one click from the error display, without leaving the dashboard.

## What Changes

- **"Fix with AI" action** on the mermaid error display, shown only when rule repair could not produce a renderable diagram AND AI repair is enabled. Never runs automatically.
- **New endpoint `POST /api/mermaid/repair`** `{ code, error }` → `{ code, model }`: one completion through the dashboard's in-process model runtime (same credential path as the model proxy, `packages/server/src/model-proxy/streamer.ts` — credentials resolved server-side, never sent to the client). Input caps, timeout, `networkGuard`, one in-flight request per server, strict output extraction. Errors use the standard envelope `{ success: false, error: <human text>, code: <machine code> }`.
- **Accept only if it renders.** The client renders the returned source through the same render + sanitize path as any diagram; a result that fails to render is reported as "AI fix failed" and the original error stays. A successful result is displayed with an "AI-fixed" indication (distinct from rule auto-fix) in the badge row from `add-mermaid-auto-repair`, with the same show-original toggle and copy-fixed action.
- **Client-side result cache** of successful repairs per (original code, model) for the page lifetime so remounts don't re-call the model.
- **Config:** optional `mermaidRepair` block in `~/.pi/dashboard/config.json` — `{ enabled, model, maxChars, timeoutMs }`. Absent/disabled → the action is hidden. `model` accepts `provider/id` only (no `:level` — the server stream path has no thinking-level channel); an `@role` value resolves to disabled with `disabledReason: "role_refs_unsupported"` (`add-role-aware-model-refs` may extend this later). The resolved block is served by the existing `GET /api/config` (no new discovery endpoint); the client reads `mermaidRepair.enabled` from it.
- **Privacy notice:** the action's tooltip states the diagram source is sent to the configured provider.

## Capabilities

### New Capabilities
- `mermaid-ai-repair`: the on-demand AI repair action, the repair endpoint contract (input limits, concurrency, output extraction, error semantics), accept-only-if-renders rule, and the AI-fixed display.

### Modified Capabilities
- `shared-config`: new optional `mermaidRepair` config block.

## Impact

- `packages/server/src/routes/mermaid-repair-routes.ts` (new), registered with `networkGuard` like the other guarded routes; resolves the model via `InternalRegistry.find` + `getApiKeyAndHeaders` and streams via the runtime's `streamSimple` without an `apiKey` override (pattern of `packages/server/src/model-proxy/streamer.ts`). Timeout via `AbortSignal.timeout` (server-core; no import from `grammar-plugin`).
- `packages/shared/src/config.ts`: `MermaidRepairConfig` type + `parseMermaidRepairConfig`, wired into `loadConfig()`; request/response types in `packages/shared/src/`.
- `packages/client/src/components/preview/MermaidBlock.tsx`: action button, pending/failed states, AI-fixed badge; `packages/client/src/lib/api/` fetch helper; client reads `mermaidRepair` from `GET /api/config`; i18n en + zh-CN + hu (catalog parity per `ui-i18n-coverage`).
- Depends on `add-mermaid-auto-repair` (badge row, `MermaidOutcome` type) — lands after it. The SVG sanitizer itself is owned by `sanitize-untrusted-rendered-content`; this change only requires AI output to use the same path.
- Rollback: remove the config block (feature hides) or revert; no persisted state.

## Discipline Skills

- `security-hardening`: untrusted diagram text leaves the machine to a model provider and model output re-enters the DOM — input caps, prompt-injection-tolerant output handling (output treated as untrusted mermaid source, rendered and sanitized like any other), auth via `networkGuard`, single in-flight request, no credential exposure to the client.
- `observability-instrumentation`: new endpoint + external call — log outcome class, latency, model and input size, never the diagram text or model output.
- `review-code`: before commit.
