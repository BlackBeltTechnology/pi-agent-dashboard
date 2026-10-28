## Why

Two gaps make Claude subscription requests bill as extra usage with the compat switch on or expected on.

**Already-open sessions.** pi 1.4 sends a session's first system message as Anthropic's `system` field for the session's whole life; a later section change only reaches the request as a mid-conversation patch. The `before_agent_start` rewrite therefore never reaches the `system` field of a session that started before the switch was on, and its requests keep failing with "You're out of extra usage".

**Upgraders.** `retire-anthropic-messages-bridge` replaced the `pi-anthropic-messages` package with a Claude subscription compat switch that defaults to off. Users who upgrade with an Anthropic sign-in already in place lose the rewrite the package used to give them: their next Claude request on the subscription fails with "You're out of extra usage" until they find the switch. The first-sign-in prompt only covers new sign-ins, not existing ones.

## What Changes

- The rewrite moves from the flows plugin into the dashboard extension (code in `packages/shared/src/dashboard-plugin/claude-compat.ts`), which pi loads into every session, including `pi-dashboard-subagents` children that previously never got it. It reads the switch from the bridge's process-global state, which the connected session mirrors on `preferences_update`. The flows plugin, its pi-flows agent factory, and the `dashboard:preferences:get` probe are removed, and so is the Providers row's "Needs the Flows plugin" notice.
- The compat rewrite also hooks pi's `before_provider_request`: with the switch on and an `anthropic` model, it applies the same anchored docs rewrite to the outgoing payload's `system` text (string or text blocks), leaving every other block, `cache_control` and the messages untouched. Sessions started before the switch was on are covered from their next request. Flow agents get the same hook through the existing agent factory.
- On the first server start where the compat switch has never been stored, the dashboard sets it once from the user's existing credentials: **on** when `~/.pi/agent/auth.json` holds an `anthropic` credential (OAuth or API key), **off** otherwise. The seeded value is saved, so the decision runs only once and never overrides a later user choice.
- An `auth.json` that cannot be read or parsed seeds nothing: the switch reads as off and stays unstored, so the next start retries.
- New installs without an Anthropic credential keep today's behaviour: off, with the existing Turn on / Not now prompt on the first Anthropic sign-in.
- No UI change. No change to the rewrite itself.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-subscription-compat`: the default-off requirement gains a one-time seed from existing Anthropic credentials; a new requirement makes the rewrite cover the outgoing request's `system` text.

## Impact

- `packages/flows-plugin/src/bridge/claude-compat.ts` — `rewritePayloadSystem(payload)` + a `before_provider_request` handler in `claudeCompatExtension`.
- Tests: `packages/flows-plugin/src/bridge/__tests__/claude-compat.test.ts`, `pi-docs-canary.test.ts`.
- `packages/server/src/persistence/preferences-store.ts` — `createPreferencesStore` gains an optional `hasAnthropicCredential` dependency; seeds and persists on load when the stored value is absent.
- `packages/server/src/server.ts` — wires the dependency to a read of `auth.json`.
- Tests: `packages/server/src/__tests__/preferences-store.test.ts`.
- Docs: `docs/faq.md` entry on extra-usage billing; CHANGELOG `[Unreleased]`.

## Discipline Skills

None apply: no auth flow, untrusted input, secrets handling, endpoint or irreversible step. The seed only checks whether an `anthropic` key exists in `auth.json`; it never reads, logs or copies the credential value.
