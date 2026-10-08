## Context

See proposal.md — Why. The model proxy already runs completions server-side: `packages/server/src/model-proxy/streamer.ts:1-14` resolves credentials through `InternalRegistry` (`find` at `packages/server/src/model-proxy/internal-registry.ts:153`, `getApiKeyAndHeaders` at `:176`) and calls the runtime's `streamSimple` WITHOUT an `apiKey` override — the runtime applies the provider's own auth path (OAuth- and api_key-aware), passing only per-model headers. `packages/grammar-plugin/src/server/backends/llm.ts:373-395` shows the one-shot shape (single user message, `temperature: 0`, abort → timeout vs other throw → provider failure) but is plugin code and passes `apiKey` directly; this change follows `streamer.ts` for credentials and copies only the control flow.

`MermaidBlock` today (`packages/client/src/components/preview/MermaidBlock.tsx:209-214`) renders via `sanitizeMermaidCode → mermaid.render → sanitizeMermaidSvg`; `mermaid.initialize` (`:189-202`) leaves `securityLevel` at mermaid's default `strict`. After `add-mermaid-auto-repair` it carries a `MermaidOutcome` cache (`ok | repaired | error`, keyed by original code + themeId — `openspec/changes/add-mermaid-auto-repair/design.md:39`) and a badge row this change adds its control to.

`GET /api/config` (`packages/server/src/routes/system-routes.ts:368-388`) returns `readConfigRedacted()` (`packages/server/src/config-api.ts:29`), i.e. the parsed `loadConfig()` result; a new block wired into `loadConfig()` is served without a new endpoint. `App.tsx:1142-1166` hydrates only named fields, so the client read of `mermaidRepair` is new code.

## Goals / Non-Goals

**Goals:** one-click, opt-in model repair for diagrams rules can't fix; safe by construction (output must render through the normal sanitize path); credentials never leave the server; bounded cost.

**Non-Goals:** automatic AI repair; streaming the answer; repairing markdown/AsciiDoc markup (`add-md-adoc-markup-repair`); writing to files (`add-preview-apply-fix-to-file` owns write-back, including its diff confirmation, for AI-fixed source too); hardening the SVG sanitizer (`sanitize-untrusted-rendered-content`); `@role` model refs (`add-role-aware-model-refs` may extend the parser later).

## Decisions

### D1 — Core server route, not a plugin
`POST /api/mermaid/repair` lives in `packages/server/src/routes/mermaid-repair-routes.ts`, registered with `preHandler: networkGuard`. `MermaidBlock` is a core component used by every surface; a plugin-owned endpoint would make a core feature depend on an optional plugin. Alternative — reuse `/v1/chat/completions` from the browser: rejected, it needs a proxy API key in the client. No imports from plugin packages (`grammar-plugin`'s `withTimeoutSignal` is not reused). The model call's signal is `AbortSignal.any([AbortSignal.timeout(timeoutMs), disconnect])` where `disconnect` aborts on the request's socket close — precedent `packages/server/src/routes/model-proxy-routes.ts:357` (a client disconnect aborts the in-flight call). A client-side abort therefore stops the provider call and releases the in-flight slot (D5) promptly; it is logged as outcome `aborted` and no response is sent.

### D2 — Request/response contract
Request `{ code: string, error: string }`. Validation order, before any model call:
1. Disabled (config `enabled` false) → 404 `disabled`.
2. `code` not a non-empty string, or `error` not a string → 400 `bad_request`.
3. `code.length > maxChars` or `error.length > 2000` → 413 `too_large`.
4. A repair already in flight on this server → 429 `busy`.

Prompt: system message states the task (return ONLY a corrected mermaid diagram, same diagram type, preserve node ids and labels, no commentary); user message carries the error and the code inside a delimited block. Stream folding: a small server-side `collectRepairText` concatenates assistant text deltas and ignores thinking/tool-call events (the grammar plugin's private `collectStreamText`, `packages/grammar-plugin/src/server/backends/llm.ts:312`, is not imported — D1). Abort classification checks the disconnect signal first: disconnect → `aborted`, no reply written; otherwise timeout → 504. Output extraction: take the first ```` ```mermaid ```` fenced block, else the whole text trimmed; strip a leading `mermaid` line; empty or > maxChars → 502 `unparseable` (the server never truncates — a clipped diagram would be a silent semantic change).

Success `{ success: true, data: { code, model } }` where `model` is the configured `provider/id`. Errors use the shared `ApiResponse` envelope (`packages/shared/src/types.ts:1590`): `{ success: false, error: <human text>, code: <machine code> }`. Codes: `disabled` 404, `bad_request` 400, `too_large` 413, `busy` 429, `timeout` 504, `provider_error` 502 (provider throw or configured model not found in the registry), `unparseable` 502.

### D3 — Validation is the client's render
The server does not import mermaid (DOM-bound). The client renders the returned source through the same queued render path (`sanitizeMermaidCode → mermaid.render → sanitizeMermaidSvg`, mermaid `securityLevel` default `strict`); only a successful render is shown. Whatever the model returns is only ever treated as mermaid source — never as HTML — so prompt-injection-shaped output gets exactly the protection any diagram in a markdown file gets. Strengthening that sanitizer is out of scope (`sanitize-untrusted-rendered-content`).

### D4 — Model resolution
`mermaidRepair.model` is `provider/id`, split on the first `/` (`packages/shared/src/model-id.ts`); the id is passed verbatim, so ids that contain `:` (e.g. OpenRouter `…:free`) work. No `:level` grammar: the server stream path (`streamer.ts:17-23,80-88`, `registry-singleton.ts:132-162`) forwards only `headers/maxTokens/temperature/signal` — there is no thinking-level channel to honor it. The route resolves via `InternalRegistry.find`; not found → 502 `provider_error`. A value starting with `@` resolves at parse time to `enabled: false, disabledReason: "role_refs_unsupported"` — a deliberate interim exception to the role-aware grammar of `add-role-aware-model-refs` (not landed; resolving roles would couple this change to its shared resolver). That change, when it lands, adds `@role` support here as a MODIFIED delta; `enabled: true` without a model → `enabled: false, disabledReason: "no_model"`. `disabledReason` rides `GET /api/config` so Settings/diagnostics can explain why the action is hidden. `temperature: 0`, `maxTokens: min(ceil(maxChars / 3), 8192)` — both pinned in the endpoint spec as the spend bound.

### D5 — Concurrency
One module-level in-flight flag per server: a second request while one is pending gets 429 `busy` without a model call. The flag clears in `finally` (also reached on disconnect-abort, D1). Bounds spend to one completion at a time across all clients. Sequential calls are not rate-limited — a deliberate choice: `networkGuard` admits only localhost/authenticated/trusted-network callers, i.e. the operator, and each call is capped (input caps, `maxTokens` 8192, timeout).

### D6 — Client states
Client reads `mermaidRepair.enabled` from `GET /api/config` (alongside the existing `App.tsx` hydration). Error display gains a "Fix with AI" button (hidden when disabled) in the `add-mermaid-auto-repair` badge row, keyboard-operable with an accessible name, tooltip disclosing the provider send. States: idle → pending (spinner, button disabled, request aborted on unmount) → ai-fixed (badge "AI-fixed · <model>", show-original, copy-fixed — same controls and a11y contract as the rule-repair badge) | failed ("AI fix failed: <reason>", original error kept, retry allowed). Page-lifetime `Map<originalCode + "\0" + model, fixedCode>` caches successes only; the cached value is theme-independent source. Strings in every shipped locale (en, zh-CN, hu) — catalog parity enforced by `ui-i18n-coverage`.

State shape: the AI state lives in `MermaidBlock` alongside — not inside — the `MermaidOutcome` union: `aiState = idle | pending | {kind:"fixed", fixedCode, model} | {kind:"failed", reason}` plus `showOriginal`. When `aiState` is `fixed`, the block renders `fixedCode` through the normal outcome cache (keyed on the fixed source + theme, so a theme change re-renders it like any diagram) and shows the AI badge; show-original displays the original source + original error. `aiState` is reset to idle (or re-hydrated from the page cache) when the original `code` or the configured model changes; the show-original view closes on any outcome change (source or theme), matching the rule-repair rule.

No MODIFIED delta on `mermaid-rule-repair`: its "Repaired diagrams are visibly marked" requirement governs rule-repaired diagrams only and does not enumerate badge-row contents (`openspec/changes/add-mermaid-auto-repair/specs/mermaid-rule-repair/spec.md:84`); the AI display requirement lives in `mermaid-ai-repair` and references that behaviour.

### D7 — Observability
One structured log line per request: `[mermaid-repair] outcome=<code|ok|aborted> model=<ref> ms=<n> chars=<n>`. Never log code, error text or model output.

## Risks / Trade-offs

- [Diagram contents sent to a third party] → opt-in config, tooltip notice, nothing sent without a click.
- [Model changes semantics (renames nodes, drops edges)] → AI-fixed badge + show-original; write-back (separate change) requires an explicit diff confirmation.
- [Cost/abuse via repeated clicks or scripted calls] → `networkGuard`; one in-flight request per server (429 `busy`); `maxTokens` hard cap 8192; input caps; disconnect aborts the provider call; button disabled while pending; client success cache. Accepted: sequential calls by an admitted caller are not rate-limited (D5).
- [Slow provider] → `timeoutMs` (default/clamps per `shared-config` delta) via `AbortSignal.timeout`; abort → 504 `timeout`, any other throw → 502 `provider_error`.
- [Sanitizer weaker than baseline spec text claims (regex vs DOMPurify)] → AI output uses the identical path, so it adds no new exposure; fix tracked by `sanitize-untrusted-rendered-content`.

## Migration Plan

Additive. Lands after `add-mermaid-auto-repair`. Config block absent → feature hidden. Restart server for route + config; `npm run build` for client. Rollback: delete the block or revert.
