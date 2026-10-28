# Design

## Context

See proposal.md (Why) for the billing evidence. Constraints that shape the approach:

- pi builds the system prompt from named sections. The built-in `docs` section holds the two flagged lines (`pi-coding-agent/dist/core/system-prompt.js:88`, `:93`). Extension-supplied `systemPromptOptions.sections` are applied **after** the built-ins (`system-prompt.js:111-114`), so a section named `docs` replaces the built-in one in place; only `preamble` is reserved (`:72`); an empty string is ignored (`if (content)`).
- `before_agent_start` gives handlers `event.systemPrompt` (the rendered current prompt) and the mutable `event.systemPromptOptions` (`pi-coding-agent/dist/core/extensions/types.d.ts:722-725`), plus `ctx.model` (`types.d.ts:227`).
- Returning `{ systemPrompt }` forces the whole prompt and drops later structured contributions. The dashboard already hit this (`packages/extension/src/dashboard-context-injector.ts`, see change `fix-forced-system-prompt-drops-tool-guidelines`). The injector writes `sections.dashboard_session` and returns `undefined`; this change follows the same pattern.
- pi-flows forwards host-registered agent extensions: listener `flow:register-agent-extension` (`pi-flows/extensions/flow-engine/index.ts:362`), deduped by factory reference (`:342-351`). Flow agents get pi's default prompt plus the agent prompt (`execution.ts:425-441`, `getSystemPrompt: () => undefined`).
- The server already pushes bridge-relevant preferences: `preferences_update` on register (`packages/server/src/event-wiring.ts:594-597`) and broadcast on change. The bridge stores the value (`packages/extension/src/bridge-handlers/dispatch.ts:203-209`, `instance.ts:140`). Message type: `packages/shared/src/protocol.ts:1659-1663`.
- Plugin config (`plugins['<id>'].*` in `~/.pi/dashboard/config.json`) has no server→bridge relay. The flows plugin's `editFlow` is pushed per session by the browser client (`packages/flows-plugin/src/client/SessionFlowMenuClaim.tsx:80`).
- The flows-plugin bridge already loads in every pi session (`packages/flows-plugin/src/bridge/index.ts`, key `dashboard-flows`).

## Goals / Non-Goals

**Goals:**
- One rewrite implementation, used by the main session and by flow agents.
- The switch takes effect on the next agent run in every connected session, with no browser open and no session restart.
- A pi upgrade that changes the docs wording fails a test instead of silently dropping users into extra usage.

**Non-Goals:**
- Rewriting anything other than the `docs` section (preamble "operating inside pi", AGENTS.md text, skills): the test showed they are not flagged.
- Distinguishing Anthropic OAuth from API-key sessions.
- Uninstalling `pi-anthropic-messages` for users, or changing that package.
- Changing pi-flows (its local change already removes its adapter).

## Decisions

### D1. Rewrite the docs text taken from the current prompt, anchored and gated
In `before_agent_start`, guard first, then rewrite:
- `ctx.model` undefined, or `ctx.model.provider !== "anthropic"` → no-op (D2).
- `event.systemPromptOptions.customPrompt` set (a `SYSTEM.md`) → no-op. pi then builds no built-in `docs` (`system-prompt.js:78-80`) but still renders custom sections (`:111-114`), so writing `sections.docs` would *add* a section.
- Otherwise extract the body with a match anchored on pi's own first docs line (sections are joined with `\n\n`, `pi-ai/dist/utils/text.js:11-18`): `<docs>\nPi documentation (` … `\n</docs>` (sections render as `<name>\n…\n</name>`, `system-prompt.js:118`). A `<docs>` tag inside AGENTS.md, skills or custom sections does not match the anchor. Rewrite only when there is **exactly one** anchored match, and only within that span; zero or several matches → no-op with the "matched nothing" log.
- Replace `pi itself` → `the cli itself` and `pi packages` → `cli packages`. Initialise `systemPromptOptions.sections ??= {}`, assign `sections.docs`, and return `undefined`.
- No anchored match → no-op, plus the "matched nothing" log (spec "Applied compat state is logged per session").
- The rewrite is idempotent: a second pass finds nothing to replace.
- A handler that returns `{ systemPrompt }` forces the whole prompt (`system-prompt.js:126-128`), and sections are then ignored. The compat handler cannot prevent this. When `event.systemPrompt` no longer carries the anchored block, it no-ops and logs "forced/custom". This repo's own prompt writers already must not force (`agent-session-context-injection`, `kb-doctrine-injection`).
- *Alternative rejected:* call pi's `buildSystemPromptSections`. It is not in pi-coding-agent's public `exports` (only `.` and `./rpc-entry`).
- *Alternative rejected:* rebuild the docs text ourselves from pi's README/docs/examples paths. It duplicates pi's template and drifts on every pi release.
- *Alternative rejected:* `before_provider_request` string replacement on the payload (what the package did). It runs after pi renders the prompt, has to handle every system message shape, and bypasses pi's structured sections and transcript deltas.

### D2. Gate on `ctx.model.provider === "anthropic"`
Applied only when the switch is on and the run's provider is `anthropic`. API-key sessions on `anthropic` get the same harmless wording change, which avoids reading credentials in the bridge. Proxy providers that speak `anthropic-messages` under another provider id (for example 9router) are not touched.
- *Alternative rejected:* check for an `sk-ant-oat` token. It needs credential access in a plugin bridge, for no billing benefit.

### D3. Store the switch in `preferences.json` and relay it with `preferences_update`
Add `claudeSubscriptionCompat: boolean` (default `false`) next to `autoNameSessions` in the preferences store. Add a PATCH route modelled on `preferences-auto-name-routes.ts` that broadcasts the change.
- `PreferencesUpdateExtensionMessage` (`protocol.ts:1659-1663`) gets both fields as optional. Every sender (the register push and both PATCH broadcasts) sends the **full snapshot** of both values. `dispatch.ts:204-209` applies each field only when it is a boolean, so an old server or a partial message never resets the other value.
- Ordering: `preferences_update` is sent from `onSessionRegistered` (`event-wiring.ts:594-597`), while the initial-prompt arm runs in the separate `onEvent` `session_register` branch (`~:1917-1935`). Their relative order is not established. Fix: also send the full preferences snapshot in that `onEvent` branch, immediately before it consumes `pendingInitialPromptRegistry`. Both messages go over the same session socket, so the bridge applies the value before `send_prompt`. The test drives the real gateway callbacks, not two calls in an assumed order.
- *Alternative rejected:* plugin config `plugins.flows.claudeSubscriptionCompat`. There is no server→bridge relay for plugin config; `editFlow` depends on an open browser to push per session, which is wrong for a billing-critical switch.

### D4. Expose the value to plugin bridges through a synchronous probe on `pi.events`
The dashboard extension answers a probe channel (proposed `dashboard:preferences:get`): the caller emits `{}` and the extension fills `probe.claudeSubscriptionCompat` from `inst`. This is the pattern `roles-plugin` uses (`packages/roles-plugin/src/bridge/index.ts:16`, `:63`). The flows-plugin bridge probes on every `before_agent_start`, so it always reads the live value. No probe answer (extension absent or older) → treat as off.
- *Alternative rejected:* the extension broadcasts an event on change. A plugin bridge loaded after the broadcast would miss it and need a replay.
- Trust model: every extension loaded in a pi process is trusted code. Any of them can answer the probe, and equally rewrite the provider payload directly, so the probe adds no new exposure. The `dashboard:` reservation in `dashboard-plugin-loader` (`spec.md:15`) only keeps *server* plugins from reaching the channel through `ctx.emitEventToSession`; it is not a defence against in-process code.
- Forwarding: the probe channel and the re-emitted `flow:register-agent-extension` (its payload carries a function) must not be forwarded to the server. Verify the forwarder's subscription mechanics (`packages/extension/src/bridge.ts` ~`:2065`, `bridge-handlers/forwarders.ts`) and extend `eventbus-rpc-probe-not-forwarded.test.ts` (precedent: `roles:get-all`).

### D5. flows-plugin bridge owns the rewrite for both paths
`packages/flows-plugin/src/bridge/` gains a pure `rewriteDocsSection(text)` and a factory `claudeCompatExtension(readSwitch)`. `readSwitch` is a `() => boolean` bound in the **parent** bridge's `activate`, probing the parent `pi.events` live on each call. The factory is created once at module level, so pi-flows' dedupe-by-reference holds across re-emits. The factory captures that getter, and the agent-side handler never touches `agentPi.events` (flow agents run in an isolated runtime, `pi-flows/extensions/flow-engine/execution.ts:396-438`; the parent's listener lives only on the parent bus).
- Main session: `activate` registers the factory's `before_agent_start` handler on the parent `pi`.
- Flow agents: `activate` emits `flow:register-agent-extension` with `{ factory }`, using one stable factory reference, and re-emits on every `session_start` (pi-flows dedupes by reference and may re-seed on `/reload`). This mirrors what the deleted bridge did (`flows-anthropic-bridge-plugin/src/bridge/index.ts:92-105`).
- Inside an agent, `ctx.model` is the agent's model, so a flow agent on a non-anthropic model is not rewritten even when its parent is.

### D6. Sign-in prompt replaces the automatic install
At `packages/client/src/components/settings/ProviderAuthSection.tsx:450`, replace `peerAutoInstallStore.ensureInstall("sign-in")` with a non-blocking Turn on / Not now prompt, shown only when a live read of the switch (not a cached value) says off. The text says the switch applies to the `anthropic` provider. When the flows plugin is disabled, the row says compat needs the Flows plugin, because the rewrite lives in its bridge (D5). The `anthropic` row shows the switch state and a switch control. Landing Step ① shows the off-state notice (spec `landing-page-onboarding`).

### D6b. Observability: log, don't surface
Per spec, each session logs its applied state once per session and on change (applied / off / not anthropic / custom-or-forced / matched nothing), with no prompt text. A UI surface for "switch on but not applied" is out of scope: the canary test (Risks) catches the main cause before release, and the row and Landing already show the switch state.

### D7. Uninstall notice reads installed packages
The notice shows when the switch is on and the installed-package list (already served for the extensions UI via `packages/server/src/package/installed-package-enricher.ts`) contains the package under either name: `@blackbelt-technology/pi-anthropic-messages` or legacy `@pi/anthropic-messages`, matched on the normalized package name, never by substring. Dismissal is stored client-side, like other one-time notices.

### D8. Deletion scope
Delete `packages/flows-anthropic-bridge-plugin/`. Remove the `pi-anthropic-messages` entry from `packages/shared/src/recommended-extensions.ts`, plus `anthropic-messages-source.ts`, `dashboard-plugin/anthropic-peer-names.ts`, the peer probe, hint and auto-install client code, and the doctor peer and bridge checks (`peers.md`, `plugins-bridges.md`, `_lib/checks.ts`, `_lib/derive-tokens.ts`). Also remove every reference in build, publish, docker, test, docs and AGENTS rows listed in proposal.md Impact.
- Gate: `rg -l 'flows-anthropic-bridge|pi-anthropic-messages|anthropic-messages-source|anthropic-peer-names|ANTHROPIC_MESSAGES_SOURCE|PI_ANTHROPIC_MESSAGES'`, excluding `CHANGELOG.md`, `Prompt stories/`, `openspec/changes/archive/`, this change's own artifacts and the kb index, returns nothing. knip, `scripts/check-conventions.mjs`, the plugin-boundary ratchet and the tailwind-source-coverage test pass.

## Risks / Trade-offs

- [pi rewords or restructures the docs section, so the rewrite silently stops matching] → A canary test reads the installed pi's default prompt and asserts it still contains both phrases inside `<docs>`; a pi bump that changes them fails CI. The bridge logs once per session when the switch is on but no phrase matched.
- [Anthropic starts checking other text] → Out of our control. Keep `probe.py` / `replay.py` (see Migration) as a manual re-check; the switch can be extended without changing the mechanism.
- [Anthropic changes what it checks; the canary only detects pi rewording] → Residual risk. A manual billing re-check (test-plan, manual-only) re-runs the spike method after each pi or Claude Code major release.
- [A re-prime/resume path may build a request without `before_agent_start`] (`agent-session.js:550-562`, unverified) → Verification task; route it through the same handler if it can.
- [Switch defaults to off, so a user who dismisses the sign-in prompt lands in extra usage] → The `anthropic` row and Landing Step ① keep showing the off state with a Turn on action.
- [Users keep `pi-anthropic-messages` installed alongside the switch] → Both rewrite the same phrases (harmless). The package's tool renaming and `/tmp` logging continue until it is uninstalled; the one-time notice prompts uninstall.
- [pi-flows 0.8.0 still loads the package into agents when it is installed] → The package rewrites (and renames tools) regardless of the switch until it is uninstalled. That is why the spec says "the *dashboard* SHALL NOT rewrite" when the switch is off. When the package is uninstalled, 0.8.0's adapter finds nothing and the registered factory applies. The pi-flows working-tree change that drops the adapter is not committed or released (unverified); this change does not depend on it.
- [First run starts before the switch value arrives] → Register push ordered before initial-prompt dispatch (D3), with a test.
- [`flow:register-agent-extension` emitted before pi-flows subscribes] → Re-emit on every `session_start` (D5).

## Migration Plan

1. Land the change. Existing users keep the package until they act. New sign-ins get the prompt instead of an install.
2. A user turns the switch on (prompt, `anthropic` row or Landing). The notice suggests uninstalling `pi-anthropic-messages`.
3. Rollback: revert the change. The package is still on npm, and the previous dashboard version re-adds it as required.
4. Keep the spike scripts outside the repo, documented in `docs/faq.md`: what they check (`anthropic-ratelimit-unified-representative-claim` header; `400 out of extra usage`) and how to re-run them.

## Open Questions

- Final probe channel name (`dashboard:preferences:get` proposed). It doesn't affect specs or tasks.
- Whether the mid-chat `tool_reference_unresolved` 400 disappears once the package is uninstalled. It's expected but unverified; a manual verification task covers it, and the outcome only decides how `track-pi-anthropic-tool-removal-fix` is closed.
