# Retire pi-anthropic-messages and the flows-anthropic-bridge plugin

## Why

The dashboard installs `@blackbelt-technology/pi-anthropic-messages` automatically after an Anthropic subscription sign-in, marks it as a required extension, and ships the `flows-anthropic-bridge` plugin to load it into flow agents. A live test on 2026-10-28 (pi 1.4.0, Claude Code 2.1.312, Sonnet 5.5 / Opus 5.5, subscription OAuth) showed:

- Tool names do not affect billing. Plain custom names (`ask_user`, `kb_search`) count against the subscription. The package's `mcp__pi__` renaming is not needed.
- pi-ai already sends the Claude Code identity line, headers and betas.
- One thing decides subscription vs extra usage: two lines in pi's built-in `docs` prompt section, "pi itself" and "pi packages". With them, a request is billed as extra usage ("You're out of extra usage"). With both changed to "cli …", it counts against the subscription. The package's only useful job was this text change.

The package also writes every prompt to a world-readable `/tmp/pi-am.log`, and its tool renaming causes the `tool_reference_unresolved` 400 when tools are removed mid-chat (tracked in `track-pi-anthropic-tool-removal-fix`). pi-flows 0.8.0 loads the package into flow agents itself. Its next release (local, not yet committed) removes that and forwards host-registered agent extensions only, through `flow:register-agent-extension`. A pi-flows faux-harness test confirmed that flow agents get pi's default `docs` section (with both lines), and that an extension registered this way replaces it.

## What Changes

- **New:** a global preference, **off by default**, stored in `preferences.json` and relayed to every bridge, the same way `autoNameSessions` is.
- **New:** the `flows-plugin` bridge (`packages/flows-plugin/src/bridge/`, already loaded in every pi session) owns the rewrite. When the preference is on and the session runs on the `anthropic` subscription provider, it replaces pi's `docs` prompt section through `before_agent_start` (`systemPromptOptions.sections.docs`), changing "pi itself" → "the cli itself" and "pi packages" → "cli packages". The same factory is emitted on `flow:register-agent-extension`, so pi-flows forwards it to every flow agent. It never replaces the whole prompt and never renames tools.
- **Changed:** when an Anthropic subscription sign-in completes, the dashboard asks the user to turn the preference on (Turn on / Not now) instead of installing the package. The authenticated `anthropic` row shows the preference state and a switch. Settings can turn it off.
- **BREAKING:** remove `pi-anthropic-messages` from `RECOMMENDED_EXTENSIONS` (currently `status: "required"`) and from the required-extension banner, landing-page Step ① peer status, peer probe, peer hint and peer auto-install.
- **BREAKING:** delete `packages/flows-anthropic-bridge-plugin` (bridge, server, settings panel, i18n, tests), its plugin-registry entry, its publish/allowlist entries and its e2e specs.
- Remove the doctor-skill peer and bridge checks for the package.
- Existing installs: show a one-time notice that `pi-anthropic-messages` can be uninstalled once the preference is on. The dashboard does not uninstall it automatically.
- Close `track-pi-anthropic-tool-removal-fix` once a manual check confirms the mid-chat `tool_reference_unresolved` 400 no longer happens without the package (the likely root cause is the package's tool renaming, not pi-ai; unverified).

## Capabilities

### New Capabilities
- `claude-subscription-compat`: the preference, its relay to bridges, the `docs` section rewrite on `anthropic` subscription sessions and flow agents (owned by the flows-plugin bridge), the sign-in prompt, and the `anthropic` row switch and state.

### Modified Capabilities
- `anthropic-peer-hint`: all requirements removed. Replaced by `claude-subscription-compat`.
- `flows-anthropic-bridge-activation`: all requirements removed (plugin deleted).
- `flows-anthropic-bridge-peer-probe`: all requirements removed (plugin deleted).
- `flows-anthropic-bridge-server`: all requirements removed (plugin deleted).
- `flows-anthropic-bridge-settings`: all requirements removed (plugin deleted).
- `landing-page-onboarding`: Step ① peer status reports the compat preference state instead of the package probe.
- `global-preferences`: adds the compat preference field (default off, relayed to bridges).
- `plugin-settings-consistency`: drops `flows-anthropic-bridge` from the plugin lists.

- `client-build-config`: plugin examples no longer name `flows-anthropic-bridge-plugin`.
- `dashboard-plugin-loader`: bridge-key, health and Electron-bundle examples use `flows` instead of `flows-anthropic-bridge`.
- `flow-plugin-e2e`: anthropic peer-probe and peer-presence e2e requirements removed; the full-stack requirement is replaced by one without the bridge check.
- `jiti-cjs-transpile-safety`: seed-3 enumeration drops `flows-anthropic-bridge-plugin`.
- `pi-package-resolver`: plugin peer-probe tier-2 requirement removed (its only consumer is deleted).
- `publish-correctness-verification`: `@pi/anthropic-messages` allowlist entry removed.

Audited, unaffected: `custom-provider-metadata-discovery`, `provider-auth-bridge`, `provider-connection-test` (they name the `anthropic-messages` API, not the package), and `doctor-skill` (package named only as an example).

## Impact

- **Client:** `ProviderAuthSection.tsx`, `PeerAutoInstallStatus.tsx`, `useAnthropicPeerProbe.ts`, `lib/package/anthropic-peer.ts`, `lib/package/peer-auto-install-store.ts`, `LandingPage.tsx`, `MissingRequiredBanner`, `SettingsPanel.tsx`, `packages/client/package.json`, generated `plugin-registry.tsx` + `plugin-sources.css`; i18n keys removed and added in all three locales (`lib/i18n-en-source.json`, `lib/i18n/i18n-hu.ts`, `lib/i18n/i18n-zh-CN.ts`).
- **Shared:** `recommended-extensions.ts`, `anthropic-messages-source.ts`, `dashboard-plugin/anthropic-peer-names.ts`, `dashboard-plugin/plugin-status.ts`, `protocol.ts` (preference relay, fields made optional), `source-matching.ts`, `route-tiers.ts`.
- **Other packages:** `packages/server/package.json`, `dashboard-plugin-runtime/src/server/plugin-status-store.ts`, `grammar-plugin/src/i18n.ts`, `mcp-server-plugin/src/server/tools.denylist.ts`, `electron/scripts/spike-local-install.mjs`.
- **Server:** `preferences-store.ts`, a preference route, `event-wiring.ts` (relay), `recommended-routes.ts`, `installed-package-enricher.ts`.
- **flows-plugin:** new docs-section rewrite in `packages/flows-plugin/src/bridge/` (main session via `before_agent_start`, flow agents via `flow:register-agent-extension`), reading the relayed preference.
- **Extension:** preference relay in `bridge-handlers/dispatch.ts` and `instance.ts`, exposed to plugin bridges; doctor skill `peers.md` / `plugins-bridges.md` / `checks.ts`. Pattern reference: `dashboard-context-injector.ts` (section write, never `{ systemPrompt }`).
- **Repo:** `packages/flows-anthropic-bridge-plugin/` deleted; `.github/workflows/publish.yml`, `knip.json`, `vitest.config.ts`, `scripts/plugin-boundary-allowlist.json`, `scripts/verify-published-imports.mjs`, `scripts/verify-lockfile-versions.mjs`, `scripts/test-selection/timings.json`, both lockfiles.
- **Docker harness:** `docker/Dockerfile` (`PI_ANTHROPIC_MESSAGES_VERSION`), `docker/test-entrypoint.sh` (package symlink), `docker/test-up.sh`, `docker/Dockerfile.AGENTS.md`.
- **Tests:** e2e `anthropic-bridge-activation.spec.ts`, `redesign-provider-add-flow.spec.ts`, `retro-ux-plugin-settings-wave-2.spec.ts`, `project-trust-headless-spawn.spec.ts`, `bus-client-goal-plugin-action.spec.ts`, `global-setup.ts`, fixtures `retro-ux/plugin-flows-anthropic-bridge.ts` and `trusted-types-budget.json`; unit tests that name the package or plugin (`publish-allowlist-complete`, `verify-lockfile-versions`, `recommended-extensions`, `source-matching`, `pi-package-resolver`, `installed-package-enricher`, `recommended-routes`, `pi-core-checker`, `useProvidersReady`, `secure-context-scan`, `tailwind-source-coverage`, `ProviderAuthSection.*`, `LandingPage`, `MissingRequiredBanner`, `RecommendedExtensions`, `peer-auto-install-store`, `plugin-settings-consistency`, doctor `checks`/`provenance-hash`, `scripts/__tests__/*` guards).
- **Docs:** `README.md`, `docs/architecture.md`, `docs/faq.md` + `faq.agent.md`, `docs/plugin-seams.md` + `.agent.md`, `docs/user-features.md`, `docs/doctor-skill.md`, `docs/security/network-surface.md`, `tests/e2e/README.md` + `.agent.md`, and every `AGENTS.md` / `*.AGENTS.md` row of a deleted or changed file.
- **pi-flows (separate repo, not a dependency):** this change works with published 0.8.0. That version still loads the package itself when it is installed; once the package is uninstalled, its adapter finds nothing and the registered flows-plugin factory applies. A pi-flows working-tree change that drops the adapter exists but is not committed or released.
- **Out of scope (separate repo):** pi-anthropic-messages: release 0.3.5 without the `/tmp/pi-am.log` logging and deprecate 0.3.2–0.3.4.
- **Risk:** Anthropic can change what it checks at any time. The test scripts (`probe.py`, `replay.py`) should be kept as a repeatable check (see design).

## Discipline Skills

- `doubt-driven-review`: removing a required extension and deleting a published plugin cannot easily be undone for users; review the migration notice and the pi-flows ordering before landing.
- `security-hardening`: the change retires a package that leaks prompts to `/tmp`; verify no leftover code path imports it.
- `observability-instrumentation`: new preference route and bridge relay; log the preference state the bridge applies so billing problems can be diagnosed.
