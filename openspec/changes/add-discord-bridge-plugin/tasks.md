## 1. Package scaffold

- [ ] 1.1 Scaffold `packages/discord-plugin/` (package.json with `pi-dashboard-plugin` manifest: id `discord`, `claims: [{ slot: "settings-section", tab: "general" }]`, server entry) and verify `GET /api/plugins` lists it as disabled
- [ ] 1.2 Add `@discordjs/core`, `@discordjs/ws`, `@discordjs/rest` deps and verify `pnpm install` resolves with no peer warnings and the package builds
- [ ] 1.3 Add `packages/discord-plugin/AGENTS.md` with one row per source file and verify `kb dox lint` reports no missing rows for the new directory

## 2. Authorization chokepoint (D2) — build before anything can act

- [ ] 2.1 Define the config schema (token, principals[], roleMap, ceiling, mirror levels, disarmed) with validation, and verify invalid configs are rejected by unit test
- [ ] 2.2 Implement the pure `resolveTier(author, roles, config, binding)` function and verify a table-driven unit test covers: unlisted user → null, snowflake only, role only, both (max wins), ceiling clamp, role mapped above `control` rejected
- [ ] 2.3 Implement the bot/webhook hard reject as the first branch and verify unit tests prove a bot-authored and a webhook-delivered message both resolve to null regardless of any matching snowflake entry
- [ ] 2.4 Implement the `NON_DELEGABLE` verb constant (device-token mint, provider write, package install, tunnel connect) and verify a unit test asserts an `operate` principal is refused each one
- [ ] 2.5 Implement the disarm flag: any `observe`+ principal may set it from Discord, only the dashboard may clear it — verify unit tests cover both directions
- [ ] 2.6 Assert no-caching: verify a unit test proves tier is re-resolved per message by changing the role set between two dispatches

## 3. Binding store (D3, D6, D9)

- [ ] 3.1 Implement the JSON binding store (workspace↔channel, session↔thread, question↔message) with atomic write, and verify a round-trip test across a simulated restart preserves bindings
- [ ] 3.2 Implement the cwd prefix matcher mapping a session cwd → bound workspace, and verify unit tests cover exact match, nested dir, sibling-prefix non-match (`/a/foo` must not match workspace folder `/a/fo`), and unbound cwd → no match
- [ ] 3.3 Implement channel auto-create with `permission_overwrites` in the create payload and verify a unit test against a stubbed REST client asserts the create call carries the `@everyone` VIEW_CHANNEL deny and that no follow-up permission PATCH is issued
- [ ] 3.4 Implement create-failure handling when the bot lacks permission and verify no channel is created and the plugin health entry reports the reason
- [ ] 3.5 Implement rename-on-workspace-rename and never-delete-on-workspace-delete (binding goes inactive) and verify unit tests for both
- [ ] 3.6 Implement thread creation on first event for an in-scope session via `ctx.onEvent`, and verify a stubbed event produces exactly one thread and one persisted binding
- [ ] 3.7 Implement thread-outlives-session and thread-deleted-does-not-kill-session and verify unit tests for both directions

## 4. Gateway lifecycle (D4)

- [ ] 4.1 Implement the outbound gateway connection with bounded exponential backoff and verify a unit test drives connect → drop → reconnect without duplicate delivery
- [ ] 4.2 Implement connect-time intent detection and verify that a missing `MESSAGE_CONTENT` or `GUILD_MEMBERS` intent surfaces in `/api/health.plugins[]` instead of failing silently
- [ ] 4.3 Implement token storage redaction and verify a test asserts the plugin config read path never returns the plaintext token and it never appears in logged output
- [ ] 4.4 Verify the disabled-by-default and enabled-without-token paths: no gateway connection attempted, health reports a configuration error

## 5. Inbound command path (D5)

- [ ] 5.1 Implement the message dispatcher that takes an already-resolved tier as a required argument and verify a type-level or unit test proves no action path exists that skips `resolveTier`
- [ ] 5.2 Implement plain-text-in-thread → `ctx.sendToSession` prompt for `control` principals and verify an integration test with a stubbed context delivers exactly one prompt
- [ ] 5.3 Implement channel-body text as inert (no prompt, no spawn) and verify a unit test asserts no action results
- [ ] 5.4 Implement scope containment — target session resolved from the binding, never from user input — and verify a unit test proves a cross-workspace session reference is refused
- [ ] 5.5 Implement `/pi abort` and the observe-tier read commands (sessions, status) and verify tier refusals are unit-tested per command
- [ ] 5.6 Implement dead-thread resume affordance and verify a message in an ended session's thread sends no prompt until resume is accepted
- [ ] 5.7 Implement refusal of any Discord-originated config mutation and verify a unit test asserts settings are unchanged

## 6. Event projection (D7)

- [ ] 6.1 Implement the mirror-level filter with names-only as default and verify unit tests assert diffs, tool arguments, tool results, and terminal output are absent at that level
- [ ] 6.2 Implement per-thread coalescing with a single in-flight post and verify a burst of N events produces a bounded number of posts within the rate budget
- [ ] 6.3 Implement elision markers for length- and rate-driven truncation and verify no test case produces a silently shortened message
- [ ] 6.4 Implement level changes applying to subsequent events only and verify already-posted messages are not rewritten
- [ ] 6.5 Implement tier-gating (not filter-gating) for explicitly pulled content and verify an untiered user's pull is refused while a permitted pull succeeds under a names-only filter
- [ ] 6.6 Verify mirroring continues while disarmed via an integration test

## 7. Questions → interactions (D8)

- [ ] 7.1 Render `ask_user` confirm/select/multiselect/input into Discord components and verify each method produces the expected component payload against a stubbed REST client
- [ ] 7.2 Implement invoker-only and `control`-minimum answer authorization and verify bystander and observer interactions are refused
- [ ] 7.3 Implement exactly-once answer delivery and verify a double-submit test delivers one answer, and that a dashboard-side answer disables the Discord components
- [ ] 7.4 Implement the text-reply fallback after interaction-token expiry and verify a valid late reply is delivered and an unmatched reply returns the option list without delivering
- [ ] 7.5 Implement blocked-visible state when no principal can answer and verify the thread shows the session as blocked
- [ ] 7.6 Implement batch-question handling and verify sub-answers arrive as one answer set

## 8. Audit (discord-command-audit)

- [ ] 8.1 Tag bot-driven sessions `discord:<snowflake>` + `channel:<id>` via `set_session_tags` and verify the tags appear on the session and are absent for dashboard-only sessions
- [ ] 8.2 Implement the append-only command log (principal, channel, thread, tier, action, target, outcome) with no edit/delete interface and verify one entry per action-bearing request, permitted or refused
- [ ] 8.3 Verify mirroring produces no log entries and that refusals record the specific reason, by unit test per refusal class
- [ ] 8.4 Implement restart persistence and ring-buffer retention and verify oldest-first discard at the bound

## 9. Settings surface

- [ ] 9.1 Build the settings-section UI (token, principals, role map, ceiling, mirror level, bindings, disarm state) and verify it renders in the dashboard general tab with the plugin enabled
- [ ] 9.2 Surface, per mapped role, which guild members can assign it, and verify a stubbed guild with a non-owner role-manager renders the delegation warning
- [ ] 9.3 Render the command log most-recent-first and verify it is reachable only from the dashboard

## 10. Verification and docs

- [ ] 10.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify zero failures
- [ ] 10.2 Run `npm run quality:changed` and verify no new Biome findings
- [ ] 10.3 Invoke the `security-hardening` discipline skill against the diff (gate chokepoint, overwrites, token handling, bot/webhook reject) and resolve every finding
- [ ] 10.4 Invoke `doubt-driven-review` on the authorization model specifically, before it is depended on by `add-discord-worktree-commands`, and record the outcome
- [ ] 10.5 Delegate `docs/discord-bridge.md` to DocScribe (caveman style) covering setup, the two privileged intents, the tier model, the privacy posture, and rollback; verify the file exists and the architecture pointer row is added
- [ ] 10.6 Manual QA against a real test guild: bind a workspace, drive a session by plain text, answer a question by button and by late text reply, disarm, and verify the command log recorded every attempt
