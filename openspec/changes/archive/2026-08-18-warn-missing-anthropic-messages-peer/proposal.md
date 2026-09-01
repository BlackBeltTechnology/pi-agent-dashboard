# Warn to install pi-anthropic-messages after an Anthropic OAuth sign-in

## Why

Settings → Providers → Provider Authentication → **Subscriptions (OAuth)** renders an
`OAuthProviderRow` for provider id `anthropic` (`auth_code` flow,
`packages/client/src/components/settings/ProviderAuthSection.tsx:104`). Signing in there connects
a Claude subscription — the path that actually needs the
`@blackbelt-technology/pi-anthropic-messages` peer (legacy name `@pi/anthropic-messages`).
Without it the `flows-anthropic-bridge-plugin` reports `waiting_peers`
(`packages/flows-anthropic-bridge-plugin/README.md`, `docs/doctor-skill.md:81`).

Nothing in the sign-in flow says so. The operator completes OAuth, sees the row flip to
**Connected** with an expiry countdown, and only discovers the missing peer much later as an
opaque bridge/flow failure — usually via the doctor skill. The success signal is precisely the
moment the operator believes setup is finished, so it is the right moment to say it is not.

## What Changes

- **Post-sign-in peer hint (minimal).** When the `anthropic` OAuth row is authenticated, the row
  SHALL render a small inline warning telling the operator to install
  `@blackbelt-technology/pi-anthropic-messages`, with a direct install affordance.
- **Authenticated only.** A signed-out `anthropic` row SHALL render no hint — an operator who has
  not connected a subscription does not yet need the peer. The hint also renders on an
  already-authenticated row at page load, not only immediately after a fresh sign-in.
- **Driven by the bridge's own probe.** The signal is
  `/api/health.plugins[flows-anthropic-bridge].lastProbe.peers["@pi/anthropic-messages"].ok ===
  false` — the bridge's two-tier resolve, which already covers workspace `node_modules`, pi-scope
  installs, npm/git/local sources and both package names. The installed-package list is **not**
  usable here: it returns one scope per call, Settings has no `cwd` for a workspace read, and it
  never sees a tier-1 `node_modules` resolution.
- **Fail-open on every other shape.** No `/api/health`, no bridge plugin row, no `lastProbe`, still
  loading ⇒ nothing is rendered. A missing signal is not evidence of a missing peer. The overall
  `lastProbe.status` is not the signal — the bridge also parks in `waiting_peers` when `pi-flows`
  is missing.
- **Non-blocking.** Advisory text only — never a modal, never a gate on sign-in, never disables
  Sign In / Sign Out.
- **Self-clearing through the probe.** A successful install reloads every connected pi session
  server-side, the bridge re-probes on `session_start`, and the hint disappears — no page reload.
  When no live session remains to reload, the surface latches an informational "installed, applies
  on the next pi session start" state until a fresh probe confirms.
- **An import failure is not an install problem.** When the probe reports the module was found but
  failed to import, the surface reports that reason instead of offering an install.
- **Scoped to the anthropic OAuth row.** No other OAuth provider (`openai-codex`,
  `github-copilot`), and no API-key row (including `anthropic-api`), produces a hint.

**Out of scope (follow-ups):**
- Auto-installing the peer, or installing it implicitly as part of the OAuth callback (v1 =
  explicit operator action).
- Reporting the bridge's other peer (`pi-flows`) or overall bridge health — doctor and the Plugins
  tab own that.
- Making the bridge re-probe on demand so the hint could clear without a session start.
- Per-session probe storage. The store is global last-writer-wins, so sessions in different
  workspaces can flip the snapshot; fixing that is a server + bridge change.
- The same hint on the LLM Providers custom-endpoint card (`api: "anthropic-messages"`), on the
  `anthropic-api` API-key row, or on any other package/provider combination.
- Surfacing the hint outside Provider Authentication (doctor/health already covers
  `waiting_peers`).

## Capabilities

### New Capabilities

- `anthropic-peer-hint`: a conditional, minimal, non-blocking hint on the **authenticated**
  `anthropic` OAuth row that the `pi-anthropic-messages` peer is missing, with an install
  affordance, suppressed entirely when the peer is already installed (either name, either scope).

## Impact

- `packages/client/src/components/settings/ProviderAuthSection.tsx` — `OAuthProviderRow`:
  conditional hint when `provider.id === "anthropic"`, `provider.authenticated`, and `peerMissing`.
  `ProviderAuthSection` owns the single probe read.
- `packages/client/src/hooks/useAnthropicPeerProbe.ts` (new) — fetches `/api/health`, derives
  `peerMissing` from the bridge probe, re-reads on package-operation completion and window focus.
  Follows the established `usePluginEnabledSet` shape.
- `packages/client/src/hooks/usePackageOperations.ts` — existing consumer for the install action
  and its per-source `statusFor` / `messageFor` state. No signature change.
- The peer probe key is imported from the bridge plugin's `peer-probe.ts` (`PEER_AM_LEGACY`) and the
  install source from the shipped `RECOMMENDED_EXTENSIONS` entry, rather than re-declared client-side.
- Tests: `packages/client/src/__tests__/ProviderAuthSection.peer-hint.test.tsx` — hint shown only when
  authenticated + probe says missing; hidden when signed out, when the probe says ok, when
  `waiting_peers` is caused by `pi-flows`, and on every fail-open shape; hidden for other OAuth
  providers and API-key rows; install enqueues the scoped source; failure surfaces; post-install
  informational state.
- Additive and reversible. No server, extension, protocol, or bridge change — the probe already
  ships end to end. Behaviour change for operators who already have the peer is limited to one
  additional `/api/health` fetch per providers-tab mount.

## Discipline Skills

- `review-code` — non-trivial client change before commit.
- `doubt-driven-review` — confirm the "installed" detection covers both package names and both
  scopes, and that the authenticated gate cannot nag an operator who never signed in.
