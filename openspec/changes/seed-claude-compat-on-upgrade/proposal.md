## Why

`retire-anthropic-messages-bridge` replaced the `pi-anthropic-messages` package with a Claude subscription compat switch that defaults to off. Users who upgrade with an Anthropic sign-in already in place lose the rewrite the package used to give them: their next Claude request on the subscription fails with "You're out of extra usage" until they find the switch. The first-sign-in prompt only covers new sign-ins, not existing ones.

## What Changes

- On the first server start where the compat switch has never been stored, the dashboard sets it once from the user's existing credentials: **on** when `~/.pi/agent/auth.json` holds an `anthropic` credential (OAuth or API key), **off** otherwise. The seeded value is saved, so the decision runs only once and never overrides a later user choice.
- An `auth.json` that cannot be read or parsed seeds nothing: the switch reads as off and stays unstored, so the next start retries.
- New installs without an Anthropic credential keep today's behaviour: off, with the existing Turn on / Not now prompt on the first Anthropic sign-in.
- No UI change. No change to the rewrite itself.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-subscription-compat`: the default-off requirement gains a one-time seed from existing Anthropic credentials.

## Impact

- `packages/server/src/persistence/preferences-store.ts` — `createPreferencesStore` gains an optional `hasAnthropicCredential` dependency; seeds and persists on load when the stored value is absent.
- `packages/server/src/server.ts` — wires the dependency to a read of `auth.json`.
- Tests: `packages/server/src/__tests__/preferences-store.test.ts`.
- Docs: `docs/faq.md` entry on extra-usage billing; CHANGELOG `[Unreleased]`.

## Discipline Skills

None apply: no auth flow, untrusted input, secrets handling, endpoint or irreversible step. The seed only checks whether an `anthropic` key exists in `auth.json`; it never reads, logs or copies the credential value.
