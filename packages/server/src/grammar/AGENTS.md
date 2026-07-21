# DOX — packages/server/src/grammar

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `abort.ts` | `withTimeoutSignal(timeoutMs, external?)` → `{signal, done}`: composes a timeout AbortController with an optional external signal; `done()` clears the timer. Shared by both backends. See change: add-composer-grammar-check. |
| `grammar-errors.ts` | `GrammarBackendError extends Error` carrying a `GrammarErrorCode`; backends throw it so the service/route map `code`→HTTP without leaking provider bodies. See change: add-composer-grammar-check. |
| `grammar-service.ts` | Backend-agnostic entry point. `checkGrammar({text,language?,config,signal?})` → discriminated `{ok:true,result}` | `{ok:false,code}` (never throws): gates on `enabled` (grammar_disabled), rejects empty (empty_text), clips to `maxChars` (sets `truncated`), dispatches by `config.backend`, maps `GrammarBackendError`→code. `getGrammarHealth(config)` → `GrammarHealth` (+ LT `/v2/languages` reachability probe). See change: add-composer-grammar-check. |
| `backends/languagetool.ts` | LanguageTool backend (offline). Pure helpers `classifyIssue` (issueType→kind), `mapMatches` (drop no-replacement/zero-length/no-op), `applyCorrections` (non-overlapping right-to-left splice → correctedText), `summarize` (kind counts, e.g. "2 spelling · 1 grammar"). IO `checkWithLanguageTool` POSTs `<url>/v2/check` (form-encoded); throws on non-OK. See change: add-composer-grammar-check. |
| `backends/llm.ts` | LLM backend. `checkWithLlm` resolves provider creds from `~/.pi/agent/providers.json` (reuses provider-probe `resolveProbeApiKey`), calls `openai-completions` (`/chat/completions`, `response_format:json_object`) or `anthropic-messages` (`/v1/messages`), temperature 0. Pure `extractJsonObject` (tolerates fences/prose) + `parseLlmResult` (re-locates each suggestion by `original`, ignoring model offsets; drops untrustworthy; falls back correctedText/summary). Throws `GrammarBackendError`. See change: add-composer-grammar-check. |
