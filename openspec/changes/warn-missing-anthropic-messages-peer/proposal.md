# Warn to install pi-anthropic-messages after an Anthropic provider is registered

## Why

Settings → Providers → LLM Providers lets an operator add a provider with
`api: "anthropic-messages"` (`API_TYPE_OPTIONS`,
`packages/client/src/components/settings/SettingsPanel.tsx:2562`). Sessions and flows targeting
an `anthropic-messages` model only behave correctly when the
`@blackbelt-technology/pi-anthropic-messages` peer is installed (legacy name
`@pi/anthropic-messages`); without it the `flows-anthropic-bridge-plugin` reports
`waiting_peers` (`packages/flows-anthropic-bridge-plugin/README.md`,
`docs/doctor-skill.md:81`).

Nothing in the add-provider flow says so. The operator saves a provider, sees it "work" (Test
button probes the base URL fine), and only discovers the missing peer much later as an opaque
bridge/flow failure — usually via the doctor skill.

## What Changes

- **Post-registration peer hint (minimal).** After a provider whose `api` is
  `anthropic-messages` is saved/registered, its provider card SHALL render a small inline
  warning telling the operator to install `@blackbelt-technology/pi-anthropic-messages`, with a
  direct install affordance.
- **Conditional only.** The hint SHALL render **only when the package is not installed**, in
  either global or workspace scope, matching either the current scoped name or the legacy
  `@pi/anthropic-messages` alias. Installed ⇒ nothing is rendered.
- **Non-blocking.** Advisory text only — never a modal, never a gate on saving the provider,
  never disables the Test button or provider use.
- **Self-clearing.** Once the install completes the hint disappears with no page reload; the
  installed-packages state already auto-refreshes on `package_operation_complete`
  (`packages/client/src/hooks/useInstalledPackages.ts`).
- **Scoped to the anthropic API.** No other `API_TYPE_OPTIONS` value produces a hint.

**Out of scope (follow-ups):**
- Auto-installing the peer, or installing it implicitly on provider add (v1 = explicit operator action).
- Peer hints for any other package/provider combination.
- Surfacing the same hint outside the provider card (doctor/health already covers `waiting_peers`).

## Capabilities

### New Capabilities

- `anthropic-peer-hint`: a conditional, minimal, non-blocking post-registration warning on an
  `anthropic-messages` provider that the `pi-anthropic-messages` peer is missing, with an
  install affordance, suppressed entirely when the peer is already installed (either name,
  either scope).

## Impact

- `packages/client/src/components/settings/SettingsPanel.tsx` — `LlmProviderCard`: conditional
  hint when `provider.api === "anthropic-messages"` and the peer is absent from installed packages.
- `packages/client/src/hooks/useInstalledPackages.ts` — read-only consumer (no signature change
  expected); an "is this package installed under either name" helper may be extracted if a
  second call site appears.
- Tests: `packages/client/src/components/__tests__/SettingsPanel.test.tsx` — hint shown only when
  missing; hidden for both package names, both scopes; hidden for non-anthropic APIs.
- Additive and reversible. No server, extension, or protocol change. Zero behaviour change for
  operators who already have the peer installed.

## Discipline Skills

- `review-code` — non-trivial client change before commit.
- `doubt-driven-review` — confirm the "installed" detection covers both package names and both
  scopes before it ships, so the hint cannot nag operators who are already correctly set up.
