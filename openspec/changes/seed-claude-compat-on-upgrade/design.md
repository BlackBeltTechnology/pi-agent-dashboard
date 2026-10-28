## Context

- The switch lives in the preferences store: `claudeSubscriptionCompat` is loaded as `data.claudeSubscriptionCompat === true` (`packages/server/src/persistence/preferences-store.ts:571`), so an absent value reads as off.
- The store already does a one-time load seed with a persisted marker: `pinSeeded` (`preferences-store.ts:534-547`), which marks the store `dirty` (`preferences-store.ts:648`) so the seed reaches disk on that load.
- `createPreferencesStore(filePath, deps)` takes injected dependencies (`preferences-store.ts:496-507`); the server builds it at `packages/server/src/server.ts:730`.
- `tryReadAuthJson()` (`packages/server/src/auth/provider-auth-storage.ts:120`) reads `auth.json` without locking or quarantining and returns `null` for unparseable content.
- New installs get the Turn on prompt on Anthropic sign-in (spec requirement "Sign-in prompts to turn the switch on"), which is unchanged.

- pi-ai builds Anthropic's `system` from the transcript's initial system message (`@earendil-works/pi-ai/dist/api/anthropic-messages.js:893-894`, `getInitialSystemMessage` + `getSystemMessageText`); later system messages render as "Updated system prompt section" text mid-conversation (`anthropic-messages.js:1059-1062`, `utils/text.js:24-35`). pi diffs per-run sections against the transcript and appends only a patch (`pi-coding-agent/dist/core/agent-session.js:1323-1328`).
- `before_provider_request` handlers may return a replacement payload (`pi-coding-agent/dist/core/extensions/runner.js:1066-1094`).

## Goals / Non-Goals

**Goals:** upgraders with an Anthropic credential get the switch on with no action; everyone else keeps off plus the sign-in prompt; the seed runs at most once per preferences file.

**Non-Goals:** detecting credentials from environment variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`) or `models.json` custom providers; distinguishing OAuth from API key; any UI.

## Decisions

### D1. Seed inside the preferences store, credential check injected

`createPreferencesStore` gets `deps.hasAnthropicCredential?: () => boolean | undefined`. When `data.claudeSubscriptionCompat` is not a boolean, the store calls it once: `true`/`false` becomes the value and marks the store dirty so it is saved on this load; `undefined` (credential state unknown) leaves the value off and unstored. No dependency → today's behaviour (off, unstored). Keeps the store free of auth imports and testable with a stub. Alternative rejected: seeding in `server.ts` after construction via `setClaudeSubscriptionCompat` — it would also run when the user has stored a value unless it re-implements the "never stored" check outside the store.

### D2. Credential check = an `anthropic` key in `auth.json`

`server.ts` wires `() => { const a = tryReadAuthJson(); return a === null ? undefined : Object.hasOwn(a, "anthropic"); }`. A missing file reads as `{}` → `false` (a genuine new install). Any credential type counts (user decision). The value is never read or logged.

### D3. No-credential start saves off

A first start with no credential persists `false`, so a credential added later (dashboard sign-in or `pi` CLI login) does not flip the switch silently; the sign-in prompt covers dashboard sign-ins (user decision).

### D4. Rewrite the outgoing Anthropic `system` text

`claudeCompatExtension` also registers `before_provider_request`: switch on + `ctx.model.provider === "anthropic"` → `rewritePayloadSystem(payload)`. It counts anchored `<docs>\nPi documentation (` blocks across every `system` text (string or `type:"text"` blocks); exactly one → rewrite that block's text with `rewriteDocsSection`, copy the payload with the new `system`, keep other blocks (incl. `cache_control`) and `messages` by reference. Zero/several blocks, nothing to replace, no `system`, or a thrown error → return `undefined` (payload unchanged). The `before_agent_start` rewrite stays: it keeps new sessions' transcripts and `ctx.getSystemPrompt()` consistent. Alternative rejected: `context_with_system` (handler then owns the whole prompt and tool declarations).

## Risks / Trade-offs

- Rewriting `system` on an already-open session changes its prompt-cache prefix once, so that one request re-caches.
- A user who signs in only through the `pi` CLI after the first start gets no prompt and stays off → accepted; the switch is visible on the Providers row and in the FAQ.
- A stored `false` from an earlier build of this release (e.g. a user who already toggled off) is respected; only an absent value seeds.
