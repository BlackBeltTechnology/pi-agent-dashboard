# Design — Automatic session topic naming

## Placement decision: pure bridge, no server proxy

The name must be the **real pi session name** (`pi.setSessionName`), which is a bridge-only capability. `@fast` role resolution (`lookupRole`) also lives in the bridge. The spike confirmed the bridge already holds every primitive needed to call a model in-process — the server's model-proxy completion is just:

```ts
const { apiKey, headers } = await registry.getApiKeyAndHeaders(model);   // ① auth — a ModelRegistry method the bridge already has
return piAiStreamSimple(model, { messages, systemPrompt }, { apiKey, headers, maxTokens }); // ② inference — a top-level pi-ai export
```

The bridge holds `registry` (`ctx.modelRegistry` → `cachedModelRegistry`) and runs inside pi (pi-ai is pi's own dependency, resolvable the same way the server does via `resolveModule("pi-ai")`). So the whole feature is bridge-local: **no `/api/…`, no round-trip, no proxy.** A session names itself even if the dashboard server is down.

### Rejected alternative: hybrid (bridge triggers, server generates)

Considered routing the model call through the server's existing `streamCompletion`. Rejected because the proxy's extra machinery (external API-key gating, request logging, concurrency limits) serves *outside HTTP clients* and is unnecessary for a one-shot internal title call. Auth — the only shared concern — is a single registry method the bridge already owns. Hybrid adds a round-trip and a server entrypoint for zero benefit. Kept here only as the fallback shape if the direct pi-ai acquisition proves unreachable at build time (it should not).

## Flow

```
 toggle(default ON) ─ preferences.json ─▶ server ─▶ bridge (config push)

 bridge, on agent_end (terminal turn):
   gate:  autoNameSessions on?  ·  nameSource !== "user"?  ·  no auto-name yet?
            │ any false ─▶ do nothing
            │ all true
   pre-filter:  first user msg is greeting / < N chars / bare slash-cmd?  ─ yes ─▶ wait next turn
            │ no
   resolve @fast → "provider/modelId"  (lookupRole)
            │ unconfigured / OAuth-only-unauthable ─▶ emit auto_name_error (once) ─▶ STOP (hard) 
            │ resolved
   streamSimple(model, {messages: window, systemPrompt: SUMMARIZER}, {apiKey, headers, maxTokens:16})
            │ throws ─▶ emit auto_name_error ─▶ wait next turn (transient)
            │ ok
   title := collected text
            │ "NULL" / empty / too long ─▶ wait next turn
            │ valid
   pi.setSessionName(title);  nameSource := "auto";  STOP (done)
            │ session_name_update (EXISTING path)
            ▼
   server mirrors meta.name + broadcasts session_updated (unchanged)

 server, on auto_name_error:  forward to subscribers ─▶ client toast + server log line
```

## Provenance state machine (`nameSource`)

The lockout hinges on distinguishing a name the bridge *itself* set from one a human set. The bridge is the only place that can, because it originates the auto-set.

```
   ┌─────────────┐  external name change (dashboard rename / in-pi /name)  ┌──────────┐
   │  unset      │ ───────────────────────────────────────────────────────▶│  "user"  │ (permanent lockout)
   │ (no source) │                                                          └──────────┘
   └─────┬───────┘                                                               ▲
         │ bridge auto-sets a valid title                                        │ any later external change
         ▼                                                                       │
   ┌──────────┐  external name change ─────────────────────────────────────────┘
   │  "auto"  │  (loop already stopped; a later manual rename escalates to "user")
   └──────────┘
```

- **Self-set detection:** the bridge records the exact title it applied. On the next observed `getSessionName()` value, if it differs from the last self-applied value AND the bridge did not just apply it → external change → `nameSource = "user"`.
- `nameSource` is dashboard-owned in `.meta.json`; the bridge's authority is the in-process "did I set this" latch. The server persists `nameSource` when the bridge reports it alongside `session_name_update` (extend that message with an optional `nameSource` field) OR the server infers `"user"` when a rename originates from its own rename path. Simplest: server tags `"user"` on any `rename_session` it forwards from the browser, and the bridge tags `"auto"`/`"user"` for in-pi changes.

## Summarizer prompt (topic, not restatement)

```
System:
You name a coding session by its TOPIC, not by restating the user's words.
Output ONLY the title: 2–5 words, Title Case, no quotes, no punctuation, no trailing period.
If the conversation has no clear topic yet (a greeting, a test message, or a
trivial one-off command), output exactly: NULL

User (transcript window):
<first substantive user message>
<first assistant reply, truncated>
```

Parse rule: trim; reject if empty, equals `NULL`, exceeds ~40 chars or ~6 words → "wait". Otherwise apply.

## Enough-info gate

Two layers, cheapest first:
1. **Pre-filter (no model call):** skip if the first user message trimmed length `< 15`, matches a greeting set (`hi|hello|hey|test|ping|thanks|ok`), or is a bare slash-command (`^/\w+$`).
2. **Model sentinel:** the `NULL` escape hatch handles everything the pre-filter misses. This is why cadence is per-turn until first success — a session that opens with "hi" then does real work gets named on the later turn.

## OAuth caveat (explicit fallback)

`registry.getApiKeyAndHeaders` cleanly covers **API-key** providers. **OAuth-only** providers (Anthropic Pro/Max, ChatGPT) need pi-ai's separate `oauth` module, which the bridge does not wire. `@fast` is almost always a cheap API-key model (Haiku, Gemini Flash), so this is usually moot. Requirement: if `@fast` resolves to an OAuth-only provider the bridge cannot authenticate, take the **hard-error branch** (emit `auto_name_error` once, stop) rather than crashing or silently looping.

## Non-goals

- No per-session toggle (global only, per proposal).
- No re-naming after the first success (once-only by design).
- No naming of already-named sessions on rollout (only sessions with `nameSource` unset and no name).
- No streaming/partial title UI — the title appears atomically via the existing rename mirror.
