# Design — Composer grammar & spell check

## Goals / Non-Goals

**Goals**
- Catch spelling/grammar issues in the composer draft *before* the prompt is sent.
- Show corrected sentences with visible highlighting + a short grammar summary in a panel
  above the chat input.
- Manual trigger (button + shortcut) AND debounced automatic trigger.
- Per-suggestion accept/reject AND apply-all, editing the controlled draft in place.
- Switchable backend: LLM (configured provider) or a local LanguageTool server.
- Fully opt-in; zero behaviour change when disabled.

**Non-Goals**
- Inline squiggly underlines inside the `<textarea>` (needs contenteditable — deferred).
- pi terminal TUI variant (follow-up change).
- Running/bundling the LanguageTool server itself.

## Why core, not a plugin (the decisive constraint)

The dashboard plugin runtime is real and rich, but its client surface is a **frozen slot
taxonomy** (`slot-types.ts`). The relevant slots are `content-view`, `content-inline-footer`,
`settings-section`, `tool-renderer`, `session-card-*`, `anchored-popover`, `breadcrumb`,
`gate`, `toast`, `rjsf-form`. **None targets the chat composer**, and there is no API for a
plugin contribution to read/write the composer's controlled `draft` (`CommandInput.tsx`).
Third-party extensions are even more limited — they emit JSON `IntentNode` descriptors via
the bridge (`plugin-intent-protocol`), not React that can hook a textarea.

Consequence: the corrections **panel** and **apply-to-draft** wiring MUST be core client
code. Precedent already exists — `QueuePanel.tsx` renders a panel directly above the chat
input from `App.tsx`. We follow that exact pattern.

The **backend** is isolated in `packages/server/src/grammar/` behind one route so it *could*
later be re-homed in a dashboard plugin server entry without touching the client. We keep it
core in v1 to avoid plugin ceremony for a personal ("local for me first") feature.

## Decision 1 — Where the check runs: server-side endpoint

`POST /api/grammar/check` runs on the dashboard server, not the client and not the attached
pi session.

- **Not client-side**: LanguageTool may be on `localhost` only reachable from the server
  host in Docker; and the `llm` backend needs provider credentials the browser must never
  hold.
- **Not via the pi session/bridge**: routing a grammar check through the live session would
  risk polluting the conversation/context and requires a session to be attached. The
  composer draft check must work even before a turn starts.
- **Server-side** matches how `POST /api/providers/test` already performs outbound provider
  probes with configured credentials — we reuse that credential-resolution path.

## Decision 2 — Backend abstraction

```ts
interface GrammarBackend {
  readonly kind: "llm" | "languagetool";
  check(text: string, language: string, signal: AbortSignal): Promise<GrammarCheckResult>;
}
```

`grammar-service.ts` selects the backend from `config.grammar.backend` per request (config
is re-read, so switching in settings takes effect without a restart).

**LanguageTool backend** — `POST <url>/v2/check` with `text`, `language` (`auto` allowed).
Map each LT `match` → `GrammarSuggestion { offset, length, original, replacement, kind,
message }` where `replacement = match.replacements[0]?.value` (drop matches with no
replacement). `kind` derived from `match.rule.issueType`/category
(`misspelling→spelling`, `grammar→grammar`, `typographical→punctuation`, else `style`).
`correctedText` = original with non-overlapping matches applied right-to-left. `summary`
computed from suggestion-kind counts.

**LLM backend** — one call to `grammar.llm` provider/model with a strict instruction:
return ONLY JSON `{ correctedText, suggestions:[{offset,length,original,replacement,kind,
message}], summary }`. Validate/parse defensively; if parsing fails, return
`suggestions:[]` with the raw corrected text if present, else a typed error. Temperature 0.
Offsets from the LLM are treated as untrusted — the client re-locates each `original` span
rather than trusting `offset` blindly (see Decision 4).

## Decision 3 — Result contract (shared)

```ts
type GrammarIssueKind = "spelling" | "grammar" | "style" | "punctuation";

interface GrammarSuggestion {
  id: string;            // stable within a result (e.g. `${offset}:${length}:${i}`)
  offset: number;        // char offset into the ORIGINAL text
  length: number;        // span length in the ORIGINAL text
  original: string;      // exact original span (source of truth for apply)
  replacement: string;   // suggested text
  kind: GrammarIssueKind;
  message: string;       // one-line explanation
}

interface GrammarCheckResult {
  backend: "llm" | "languagetool";
  correctedText: string; // full apply-all target
  suggestions: GrammarSuggestion[];
  summary: string;       // e.g. "2 spelling · 1 subject-verb agreement"
  language: string;      // resolved language actually used
  truncated: boolean;    // text exceeded maxChars and was clipped
}
```

## Decision 4 — Apply semantics (offset-safe)

- **Apply all**: `onDraftChange(result.correctedText)`, clear the panel.
- **Accept one**: locate the suggestion's `original` at `offset` in the *current* draft; if
  it no longer matches (user edited), re-find the nearest occurrence of `original`; if still
  not found, disable that suggestion as stale. On success, splice `replacement` in and
  **re-run the check** (simplest correct behaviour) OR locally adjust remaining suggestion
  offsets by the length delta. v1: re-run the check after an accept to avoid offset-drift
  bugs; it is debounced and cheap for LanguageTool.
- **Dismiss one**: remove from the panel, no draft change.
- All edits flow through the existing controlled `draft` / `onDraftChange` so undo,
  per-session draft persistence, and image attachments are unaffected.

## Decision 5 — Triggering

- **Manual**: a Check button in the composer toolbar + a keyboard shortcut. Always allowed
  when `enabled` and draft length ≥ 1.
- **Auto** (`autoCheck`): a debounced effect in `useGrammarCheck` fires `debounceMs` after
  the last `draft` change when `draft.length ≥ minChars`. A new keystroke aborts the
  in-flight request (`AbortController`) and resets the timer. Auto-check is skipped while
  `sessionStatus === "streaming"` and when the draft is a slash-command (`/…`) or bare
  `!`/`!!` shell input.
- Switching sessions or clearing the draft aborts and hides the panel.

## Decision 6 — Highlighting in the panel

A textarea cannot style substrings, so highlighting lives in `GrammarPanel`. For each
suggestion (or for the corrected sentence containing it) render the original span with
`line-through` + error color and the `replacement` with an additive/success color, plus the
`message`. Theme-aware via existing Tailwind theme tokens (see `theme-system`). The panel is
keyboard-navigable and screen-reader labelled (a11y baseline already exists in the repo).

## Decision 7 — Config validation & clamping

`parseGrammarConfig(raw)` mirrors `parseOpenSpecPollConfig`: coerce/clamp numerics
(`debounceMs` 300–10000, `minChars` 1–500, `maxChars` 100–20000), default `backend` to
`languagetool`, `language` to `auto`, `languagetool.url` to `http://localhost:8081`,
`enabled` to `false`. Unknown fields ignored. A config lacking `grammar` yields the disabled
default.

## Security & privacy

- Endpoint is auth-gated by the existing chain; feature-gated by `grammar.enabled`.
- Input is capped at `maxChars` (server clips + sets `truncated`), rejecting empty text.
- The draft is only transmitted when a check is explicitly requested (manual) or the
  debounce fires with auto-check ON — documented clearly, since with the `llm` backend the
  draft leaves the machine to the provider. LanguageTool (local) keeps it on-box.
- Provider credentials never reach the browser; the `llm` backend resolves them server-side.
- Backend errors are caught and returned as typed, non-leaky error codes (no raw provider
  bodies, no stack traces to the client).

## Observability

- Structured log per check: backend, language, input length, latency, suggestion count,
  error code. No draft contents logged.
- `GET /api/grammar/health` surfaces active backend + LanguageTool reachability for the
  settings UI and the `doctor` skill.

## Alternatives considered

- **Pure plugin** — rejected: no composer slot; plugins cannot touch the draft (see above).
- **Client-side check** (browser calls LanguageTool / LLM directly) — rejected: CORS/host
  reachability for LT, and provider secrets cannot live in the browser.
- **Route through the pi session** — rejected: context pollution, requires an attached
  session, and couples composer UX to turn state.
- **Bundle LanguageTool** — deferred: heavy (JVM) dependency; document self-host instead.

## Testing strategy

- Unit: `parseGrammarConfig` clamping; LanguageTool match→suggestion mapping + `correctedText`
  reconstruction (fixtures); LLM JSON parse/guard (malformed → safe result); offset-safe
  apply (accept-one, stale-suggestion re-find).
- Server: route auth-gate, disabled-feature 409, empty/oversized-text handling, backend
  dispatch, error mapping (mocked LT/LLM).
- Client: `useGrammarCheck` debounce + abort-on-keystroke; `GrammarPanel` render of
  suggestions/summary; Accept/Dismiss/Apply-all draft mutations; auto-check skip while
  streaming / for slash & shell inputs.
- E2E (Playwright, docker harness): type a misspelled draft → panel appears → Apply all →
  draft is corrected → send. Manual Check button path. Backend switch in settings.
