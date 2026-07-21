# Add grammar & spell check to the dashboard chat composer

## Why

When you type a prompt into the dashboard web chat, there is no way to catch spelling or
grammar mistakes before the prompt is sent to the agent. Non-native English speakers
(the dashboard ships a Hungarian locale, `packages/client/src/lib/i18n/i18n-hu.ts`) and
anyone typing fast wants a quick "clean up my draft" pass with visible corrections and a
short explanation — the same affordance a word processor gives.

This must be delivered as a **core dashboard change, not a pure plugin**. The plugin slot
taxonomy is a frozen named list (`@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.ts`:
`content-view`, `settings-section`, `tool-renderer`, `session-card-*`, `breadcrumb`,
`gate`, `toast`, `rjsf-form`, …) with **no chat-composer slot**, and third-party
extensions can only emit JSON UI-intent descriptors — they cannot reach the composer's
controlled draft state (`draft` / `onDraftChange` in
`packages/client/src/components/chat/CommandInput.tsx`). So the corrections panel and the
apply-to-draft behaviour must live in core client code, mounted above the composer exactly
like the existing "mid-turn prompt queue" panel (`QueuePanel.tsx`, rendered in `App.tsx`).

What *is* pluggable is the **check backend**. The dashboard server already makes outbound
provider/LLM calls with configured credentials (`POST /api/providers/test`, the OAuth
handlers in `packages/server/src/auth/provider-auth-handlers.ts`), so a server-side check
endpoint can run either an LLM backend (reuse configured provider credentials) or a local
[LanguageTool](https://languagetool.org/) HTTP server (offline). The backend is
switchable via config.

### Assumptions (please correct any)

- **Scope of THIS change = the dashboard web chat only.** The `pi` terminal TUI variant is
  a follow-up (see Out of Scope) that reuses the same `POST /api/grammar/check` endpoint.
  This keeps the change surgical and shippable; you asked for "dashboard first".
- **Both backends ship in v1** (LLM + LanguageTool), switchable in settings — matching your
  "LLM and local server changeable" answer. Default backend is `languagetool` (offline,
  no token cost); falls back / can be switched to `llm`.
- **Apply model = per-suggestion accept/reject AND apply-all** — matching your answer.
- **Corrections are highlighted in the panel above the composer**, not as inline squiggles
  inside the `<textarea>` (a textarea cannot render styled spans; inline underlines would
  require rewriting the composer as a contenteditable — out of scope for v1).
- **Opt-in**: the whole feature is behind `grammar.enabled` (default `false`) so existing
  users see no change until they turn it on.

## What Changes

- **NEW** shared config block `DashboardConfig.grammar` in `packages/shared/src/config.ts`:
  ```ts
  grammar?: {
    enabled: boolean;                 // default false (opt-in)
    backend: "llm" | "languagetool";  // default "languagetool"
    autoCheck: boolean;               // default true — debounced auto-check
    debounceMs: number;               // default 1200, clamp 300–10000
    minChars: number;                 // default 12, clamp 1–500
    maxChars: number;                 // default 4000, clamp 100–20000
    language: string;                 // default "auto" (e.g. "en-US", "hu-HU")
    languagetool?: { url: string };   // default "http://localhost:8081"
    llm?: { provider: string; model: string }; // reuses configured provider creds
  }
  ```
  with a `parseGrammarConfig(raw)` validator + clamping, mirroring the existing
  `parseOpenSpecPollConfig` pattern, wired into `loadConfig()`.

- **NEW** server module `packages/server/src/grammar/`:
  - `grammar-types.ts` — the `GrammarSuggestion` / `GrammarCheckResult` shapes shared with
    the client via `packages/shared`.
  - `grammar-service.ts` — `checkGrammar(text, opts): Promise<GrammarCheckResult>` that
    dispatches to the configured backend, caps input at `maxChars`, and never throws raw
    provider errors to the client.
  - `backends/languagetool.ts` — POSTs to `<languagetool.url>/v2/check`, maps LT `matches`
    → `GrammarSuggestion[]`, derives `correctedText` by applying non-overlapping matches.
  - `backends/llm.ts` — calls the configured `grammar.llm` provider/model with a structured
    prompt, parses a strict JSON response into `GrammarCheckResult`. Resolves provider
    credentials the same way `provider-routes.ts` / the providers-test probe does.

- **NEW** REST route `packages/server/src/routes/grammar-routes.ts`, registered in
  `packages/server/src/server.ts`:
  - `POST /api/grammar/check` — body `{ text, language? }` → `GrammarCheckResult`.
    Auth-gated via the existing auth chain. Returns `409`/`400` with a typed error code
    when the feature is disabled, the backend is unreachable, or `text` is empty/too long.
  - `GET /api/grammar/health` — reports the active backend and, for LanguageTool, whether
    the configured server is reachable (used by settings UI).

- **NEW** client hook `packages/client/src/hooks/useGrammarCheck.ts` — owns debounce
  (`debounceMs`), in-flight `AbortController` (cancel on new keystroke / session switch),
  manual vs auto trigger, loading/error state, and calls `POST /api/grammar/check`.

- **NEW** client component `packages/client/src/components/chat/GrammarPanel.tsx` —
  rendered above the composer (sibling to `QueuePanel` in `App.tsx`). Shows the corrected
  sentences with **diff highlighting** (removed spans struck/red, replacements green), the
  grammar **summary**, per-suggestion **Accept**/**Dismiss**, an **Apply all** button, and
  a close control. Hidden when the feature is off or there is nothing to show.

- **MODIFY** `packages/client/src/components/chat/CommandInput.tsx` — add a **Check** button
  to the composer toolbar and a keyboard shortcut that trigger a manual check; wire the
  debounced auto-check off `draft` changes; expose apply callbacks that splice a single
  suggestion into `draft` (offset-adjusting the remainder) or replace `draft` with
  `correctedText`. All mutations go through the existing controlled `draft`/`onDraftChange`.

- **NEW** settings section (client + server persistence via the existing config-write path)
  "Grammar & Spelling": enable toggle, auto-check toggle, backend select, debounce, language,
  LanguageTool URL (+ reachability check via `/api/grammar/health`), LLM provider/model.

- **i18n** — every new user-facing string added to `packages/client/src/lib/i18n/i18n.tsx`
  and translated in `i18n-hu.ts`.

- **DOCUMENTATION** — `docs/architecture.md` gets a "Composer grammar check" section (data
  flow: draft → debounce → `/api/grammar/check` → backend → panel → apply-to-draft; the
  opt-in + backend-switch config; LanguageTool self-host setup). Directory `AGENTS.md`
  rows for every new file.

## Capabilities

### New Capabilities

- `grammar-check-service` — server-side, auth-gated `POST /api/grammar/check` +
  `GET /api/grammar/health` with a switchable `llm` / `languagetool` backend, input caps,
  a stable suggestion/result contract, and structured logging of the external call.
- `composer-grammar-check` — client-side composer integration: a corrections panel above
  the chat input with diff-highlighted corrections + grammar summary, a manual Check
  button/shortcut, debounced auto-check, and per-suggestion + apply-all editing of the
  controlled draft, all behind the opt-in flag.

### Modified Capabilities

- `shared-config` — adds the optional `grammar` block and its `parseGrammarConfig`
  validator; configs without the block continue to parse unchanged.

## Out of Scope

- **pi terminal TUI variant** — deferred to a follow-up change
  (`add-grammar-check-terminal-extension`) that uses `ctx.ui` widget/overlay +
  `getEditorText`/`setEditorText` and reuses either `/api/grammar/check` or the pi session's
  own model directly. This change deliberately ships the dashboard first.
- **Inline in-textarea squiggly underlines** — requires replacing the `<textarea>` with a
  contenteditable overlay; corrections are shown in the panel instead.
- **Bundling / auto-starting a LanguageTool server** — the user runs their own LT instance;
  we only POST to it and document the setup. (A future change could add a bundled LT.)
- **Grammar quality guarantees for arbitrary languages** — quality is whatever the chosen
  backend/model provides; we pass `language` through and default to `auto`.
- **Checking messages the agent sends, or already-sent prompts** — only the *draft* in the
  composer is checked.

## Discipline Skills

security-hardening (untrusted draft text forwarded to an external LLM/LanguageTool via a
new auth-gated endpoint using provider credentials), observability-instrumentation (new
endpoint + external call needs latency/error logging and a health probe),
performance-optimization (debounce budget, abort-on-keystroke, input caps, and LLM token
cost must be bounded).
