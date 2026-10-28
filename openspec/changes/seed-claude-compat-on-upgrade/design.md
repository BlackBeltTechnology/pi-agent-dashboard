## Context

- The switch lives in the preferences store: `claudeSubscriptionCompat` is loaded as `data.claudeSubscriptionCompat === true` (`packages/server/src/persistence/preferences-store.ts:571`), so an absent value reads as off.
- The store already does a one-time load seed with a persisted marker: `pinSeeded` (`preferences-store.ts:534-547`), which marks the store `dirty` (`preferences-store.ts:648`) so the seed reaches disk on that load.
- `createPreferencesStore(filePath, deps)` takes injected dependencies (`preferences-store.ts:496-507`); the server builds it at `packages/server/src/server.ts:730`.
- `tryReadAuthJson()` (`packages/server/src/auth/provider-auth-storage.ts:120`) reads `auth.json` without locking or quarantining and returns `null` for unparseable content.
- New installs get the Turn on prompt on Anthropic sign-in (spec requirement "Sign-in prompts to turn the switch on"), which is unchanged.

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

## Risks / Trade-offs

- A user who signs in only through the `pi` CLI after the first start gets no prompt and stays off → accepted; the switch is visible on the Providers row and in the FAQ.
- A stored `false` from an earlier build of this release (e.g. a user who already toggled off) is respected; only an absent value seeds.
