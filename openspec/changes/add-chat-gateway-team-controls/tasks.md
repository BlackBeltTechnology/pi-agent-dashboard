> **Blocked on `add-chat-gateway`.** Every section from 2 onward extends that change's
> plugin, routing table, and PromptBus rendering. Section 1 (the host seam) is independent
> and can land first.

## 1. Host workspace seam (D4, spec `plugin-workspace-seam`)

- [x] 1.1 Add `listWorkspaces()` to `ServerPluginContext` + `ServerContextDeps` returning a defensive copy of `{ id, name, folders }`, and verify a unit test proves mutating the returned value leaves the preferences store unchanged
- [x] 1.2 Add `onWorkspacesChanged(handler): () => void` fired from **all nine** preferences-store mutators (`createWorkspace`, `renameWorkspace`, `deleteWorkspace`, `setWorkspaceCollapsed`, `addFolderToWorkspace`, `removeFolderFromWorkspace`, `moveFolderToWorkspace`, `reorderWorkspaceFolders`, `reorderWorkspaces`) — NOT from `broadcastWorkspaces()` — and verify a test asserts notification for each mutator by name, including a mutation path that performs no client broadcast
- [x] 1.3 Add a completeness guard test that enumerates the store's mutator surface and fails when a mutator exists without notification wiring, and verify it fails when one wiring is removed
- [x] 1.4 Wire per-subscriber try/catch and verify a throwing handler neither blocks other subscribers nor fails the workspace mutation
- [x] 1.5 Verify additivity: run the existing `dashboard-plugin-runtime` + `server` suites and confirm no existing context member changed shape
- [x] 1.6 Update `packages/dashboard-plugin-runtime/src/server/AGENTS.md` + the `packages/server/src/` rows for the seam and verify `kb dox lint` reports no missing/stale rows

## 2. Layer scaffold inside chat-gateway's plugin (D1, D5, D6)

- [ ] 2.1 Add the team-controls modules to chat-gateway's package (no second plugin, no second gateway connection) and verify the plugin still activates with one gateway connection and one routing table
- [ ] 2.2 Ensure the manifest declares a priority inside the host's trusted range (`priority <= 100`) and verify `assignSessionRef` is available at runtime rather than silently no-opping
- [ ] 2.3 Add a dependency on `@blackbelt-technology/pi-dashboard-mcp-server-plugin` for its `./manifest` export and verify `pnpm install` resolves and the package builds
- [ ] 2.4 Define the layer's config schema (per-binding principals + role maps, ceiling, mirror levels, disarm flag) with validation, and verify invalid configs are rejected
- [ ] 2.5 Implement the plugin-owned binding store (workspace↔channel) with atomic write, and verify a restart round-trip preserves bindings and provisions no duplicate channels
- [ ] 2.6 Add `AGENTS.md` rows for every new source file and verify `kb dox lint` reports no missing rows

## 3. Authorization chokepoint (D2, D3) — build before anything can act

- [ ] 3.1 Import `GENERATED_TOOLS` from `…/mcp-server-plugin/manifest` as the verb→tier lookup (NOT `MANIFEST` — its `tier` is absent on 144/156 rows) and verify a test asserts every allowlisted command's verb resolves to a tier there
- [ ] 3.2 Define the curated command allowlist and verify a verb outside it is refused even when the principal's tier would permit that verb's tier
- [ ] 3.3 Implement `authorize()` returning a discriminated `Grant | Refusal` (never a nullable tier) with reasons `non_human_author`, `unbound_channel`, `no_principal_mapping`, `scope_violation`, `disarmed`, `non_delegable_verb`, `insufficient_tier` — verify a table-driven test covers every reason
- [ ] 3.4 Implement scope containment inside the chokepoint (step 7) and verify a cross-workspace target refuses with `scope_violation`, and that no separate call site can skip it
- [ ] 3.5 Implement per-binding principal/role scoping and verify a principal mapped at `control` for one binding refuses in another
- [ ] 3.6 Implement the bot/webhook hard reject as the first branch and verify it refuses even when the bot's identifier matches a configured principal
- [ ] 3.7 Implement role-map bounds (roles cap at `control`; `operate` requires an explicit identifier) and verify config validation rejects a role mapped to `operate`
- [ ] 3.8 Implement the ceiling with an `observe` default and verify clamping plus the default on a fresh install
- [ ] 3.9 Implement the `NON_DELEGABLE` constant (`mint_device_token`, `set_providers`, `install_package`, `tunnel_connect`) and verify an `operate` principal is refused each
- [ ] 3.10 Implement disarm (any `observe`+ principal from chat; only the dashboard re-arms) and verify both directions plus that mirroring continues while disarmed
- [ ] 3.11 Verify tier is re-resolved per request by changing the role set between two dispatches
- [ ] 3.12 Verify the layering invariants: the tier layer never admits a principal L1 rejected, and never permits a binding L2 refused
- [ ] 3.13 Implement the trust-failure rule — a trusted-gated verb returning the host's no-op marks the plugin unhealthy naming the missing trust level and refuses the originating command — and verify a stubbed untrusted context yields a refusal, not a phantom success
- [ ] 3.14 Verify no action path reaches a session without a `Grant`, by making the dispatcher require one as an argument and asserting it in test

## 4. Workspace binding + channel provisioning (D7, D8)

- [ ] 4.1 Insert the workspace source into chat-gateway's cwd-resolver precedence chain and verify resolution order against the modified requirement
- [ ] 4.2 Enforce the `allowedRoots`-narrowing invariant: a workspace folder outside `allowedRoots` is inert — verify it never resolves, never spawns, and is reported as inert on the configuration surface
- [ ] 4.3 Implement the cwd→workspace matcher (symlinks resolved, segment-boundary match, longest match wins) and verify sibling-prefix non-match (`/a/foo` vs folder `/a/fo`), nested folders across workspaces, symlinked cwd, and unbound cwd
- [ ] 4.4 Implement channel provisioning with `permission_overwrites` in the create payload and verify against a stubbed REST client that the `@everyone` view deny is in the create call and no follow-up permission PATCH is issued
- [ ] 4.5 Implement provisioning-failure handling when overwrites cannot be set and verify no channel is created and the reason appears in the plugin health entry
- [ ] 4.6 Implement overwrite reconciliation on the layer's own config-write path plus an activation sweep, and verify a removed principal loses access, an added one gains it without recreation, and a change made while down is reconciled at activation
- [ ] 4.7 Implement rename-on-workspace-rename and inactive-on-workspace-delete driven by `onWorkspacesChanged` + a `listWorkspaces()` re-read (idempotent, tolerant of coalesced and irrelevant fires) and verify both, plus that a collapse/reorder fire causes no platform call
- [ ] 4.8 Implement channel-deleted-drops-binding without touching sessions and verify sessions keep running

## 5. Output filter (D9)

- [ ] 5.1 Implement the structured-payload filter with names-only as default and verify tool arguments, tool results, diffs, and terminal output are absent at that level
- [ ] 5.2 Verify the stated boundary: assistant prose quoting a diff is mirrored as written, and the configuration surface states the filter bounds structured payloads only
- [ ] 5.3 Implement per-thread coalescing with a single in-flight post and verify a burst produces a bounded number of posts within the rate budget
- [ ] 5.4 Implement elision markers for length- and rate-driven truncation and verify no case produces a silently shortened message
- [ ] 5.5 Implement level changes applying to subsequent events only and verify already-posted messages are not rewritten
- [ ] 5.6 Implement tier-gated pulls and verify an untiered user's pull is refused while a permitted pull succeeds under a names-only filter

## 6. Question-answer gating (D10)

- [ ] 6.1 Gate `prompt_response` submission at `control` and verify a below-`control` principal's control activation sends no response and leaves the session blocked
- [ ] 6.2 Implement invoker-only for invoker-raised questions and verify a bystander's activation sends nothing
- [ ] 6.3 Implement any-`control` answering for questions no chat principal invoked and verify an attached-session question does not deadlock
- [ ] 6.4 Verify the gate composes with chat-gateway's existing defer/dismiss machinery without respecifying it: a refused activation still acknowledges the interaction and produces no "interaction failed"

## 7. Audit (D11)

- [ ] 7.1 Attach provenance via `ctx.assignSessionRef` (plugin-owned ref, not the user-curated tag namespace) carrying principal + channel + binding, and verify it persists across a dashboard restart and is absent for dashboard-only sessions
- [ ] 7.2 Implement the append-only command log (principal, channel, thread, tier, verb, target, outcome, refusal reason) with no edit or delete interface and verify one entry per action-bearing request, permitted or refused
- [ ] 7.3 Verify mirroring produces no log entries and that each refusal class records its own distinct reason
- [ ] 7.4 Implement restart persistence and ring-buffer retention and verify oldest-first discard at the bound

## 8. Configuration surface

- [ ] 8.1 Extend chat-gateway's settings panel with per-binding principals, role map, ceiling, mirror level, bindings, and disarm state, and verify it renders with the plugin enabled
- [ ] 8.2 Surface per mapped role who can assign it, and verify the delegation warning renders for a role assignable by a non-owner and states the missing permission when that information is unavailable
- [ ] 8.3 Show per bound workspace which folders are outside `allowedRoots` and therefore inert, and verify the display against a workspace with a mixed folder set
- [ ] 8.4 Render the command log most-recent-first via `registerBrowserHandler` (no new HTTP route) and verify it is unreachable from chat
- [ ] 8.5 Verify every configuration mutation refuses when attempted from chat at any tier

## 9. Verification and docs

- [ ] 9.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify zero failures
- [ ] 9.2 Run `npm run quality:changed` and verify no new Biome findings
- [ ] 9.3 Invoke the `security-hardening` discipline skill against the diff (the `authorize` chokepoint, the `allowedRoots`-narrowing invariant, overwrite reconciliation, bot/webhook reject, the host seam) and resolve every finding
- [ ] 9.4 Invoke `doubt-driven-review` on the tier model before anything rides ship/merge verbs on it, and record the outcome
- [ ] 9.5 Delegate the team-controls section of chat-gateway's doc to DocScribe (caveman style) covering the tier model, per-binding mappings, the `allowedRoots`-narrowing rule, the structured-payload-only filter boundary, and rollback; verify the file exists and the architecture pointer row is added
- [ ] 9.6 Manual QA against a real test guild: bind a workspace, drive a session as `control`, confirm an `observe` principal cannot prompt or answer, revoke a principal and confirm lost channel access, disarm from chat and confirm only the dashboard re-arms, and verify the command log recorded every attempt with its reason

## 10. Tests — folded from test-plan.md (automated rows)

Exemplars to copy harness glue from: **L1 authorization/binding/filter/audit** → `packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts` (stubbed `ServerPluginContext` pattern); **L1 seam** → `packages/dashboard-plugin-runtime/src/server/__tests__/plugin-enabled.test.ts` + `packages/server/src/__tests__/preferences-store.test.ts`; **L3 config surface** → `tests/e2e/plugin-settings-pages.spec.ts` (and `tests/e2e/blackhole-settings.spec.ts` for a plugin-owned panel).

### 10a. Tier resolution and refusals (L1)

- [ ] 10a.1 Test identifier+role max-wins: principal listed `observe` by id and holding a role mapped `control`, ceiling `operate` · authorize a `send_prompt` · grant tier is `control` (test-plan #E1; see `plugin-action-handler.test.ts`)
- [ ] 10a.2 Test ceiling clamp: principal mapped `operate`, ceiling `control` · authorize any verb · grant tier is `control`, never `operate` (test-plan #E2; see `plugin-action-handler.test.ts`)
- [ ] 10a.3 Test default ceiling: config with no ceiling key · authorize a `control`-tier verb for an `operate`-mapped principal · tier is `observe` and the verb refuses `insufficient_tier` (test-plan #E3; see `plugin-action-handler.test.ts`)
- [ ] 10a.4 Test per-binding scoping: principal mapped `control` on binding A only · authorize in binding B · `Refusal{no_principal_mapping}` (test-plan #E4; see `plugin-action-handler.test.ts`)
- [ ] 10a.5 Test fail-closed fresh binding: new binding with zero principals while another binding holds 3 at `operate` · authorize from each of those 3 in the new binding · all three refuse `no_principal_mapping` (test-plan #E5; see `plugin-action-handler.test.ts`)
- [ ] 10a.6 Test all seven refusal reasons: one fixture per reason · authorize each · 7 distinct reason codes, exactly one per fixture (test-plan #E6; see `plugin-action-handler.test.ts`)
- [ ] 10a.7 Test bot author outranks a mapping: `author.bot=true` with an id equal to a principal mapped `operate` · authorize · `Refusal{non_human_author}` (test-plan #E7; see `plugin-action-handler.test.ts`)
- [ ] 10a.8 Test webhook author: message carrying `webhook_id` and no `author.bot` · authorize · `Refusal{non_human_author}` (test-plan #E8; see `plugin-action-handler.test.ts`)
- [ ] 10a.9 Test role→`operate` rejected: config mapping a role to `operate` · schema validation · rejected with the operate-requires-identifier reason and not persisted (test-plan #E9; see `config-redact.test.ts`)
- [ ] 10a.10 Test verb tier is read not declared: stub `GENERATED_TOOLS` row for `resume_session` altered to `operate` · authorize `resume_session` as `control` · `Refusal{insufficient_tier}` (test-plan #E10; see `plugin-action-handler.test.ts`)
- [ ] 10a.11 Test verb outside the curated allowlist: `operate` principal, verb `shutdown_server` · authorize · refused despite sufficient tier (test-plan #E11; see `plugin-action-handler.test.ts`)
- [ ] 10a.12 Test verb absent from the tier table: allowlisted command naming a verb with no `GENERATED_TOOLS` row · authorize · refused with no tier inferred (test-plan #E12; see `plugin-action-handler.test.ts`)
- [ ] 10a.13 Test the NON_DELEGABLE four at `operate`: principal at `operate`, ceiling `operate` · each of `mint_device_token`, `set_providers`, `install_package`, `tunnel_connect` · all four refuse `non_delegable_verb` (test-plan #E13; see `plugin-action-handler.test.ts`)
- [ ] 10a.14 Test per-request re-resolution latency: 10,000 sequential authorize calls over 50 principals × 20 roles · measure · p95 under 1ms with no caching (test-plan #P4; see `plugin-action-handler.test.ts`)
- [ ] 10a.15 Test role removed mid-conversation: principal whose only `control` grant is a role · remove the role and send a second request · second resolves lower or refuses, no restart (test-plan #X16; see `plugin-action-handler.test.ts`)
- [ ] 10a.16 Test disarm then re-arm: `observe` principal disarms · `control` principal attempts chat re-arm, then the dashboard re-arms · chat refused and state persists, dashboard restores action handling (test-plan #X14; see `plugin-action-handler.test.ts`)
- [ ] 10a.17 Test mirroring survives disarm: layer disarmed · bound session emits events · events mirrored while every action-bearing request refuses (test-plan #X15; see `plugin-action-handler.test.ts`)
- [ ] 10a.18 Test no path reaches a session without a Grant: dispatcher invoked without a grant · attempt every action verb · no session affected (test-plan #X11; see `plugin-action-handler.test.ts`)
- [ ] 10a.19 Test scope violation: binding for ws A, request naming a session whose cwd is in ws B · authorize · `Refusal{scope_violation}` and the session unaffected (test-plan #X12; see `plugin-action-handler.test.ts`)
- [ ] 10a.20 Test free-text cwd rejected: message text supplying a cwd including `..` traversal · resolve a target · text never used, no spawn (test-plan #X13; see `plugin-action-handler.test.ts`)
- [ ] 10a.21 Test the layer cannot widen L1: principal with a `control` mapping but absent from the L1 allowlist · inbound action-bearing message · refused at L1, mapping grants nothing (test-plan #X17; see `plugin-action-handler.test.ts`)
- [ ] 10a.22 Test the layer cannot widen L2: non-admin principal at `operate` attempts a channel binding · bind attempt · refused by L2 despite the tier (test-plan #X18; see `plugin-action-handler.test.ts`)
- [ ] 10a.23 Test trusted-gated no-op detection: stubbed untrusted context where `assignSessionRef` returns false · drive a session from chat · plugin reports unhealthy naming the missing trust level and the command refuses with that reason (test-plan #X10; see `plugin-enabled.test.ts`)

### 10b. Workspace binding and channel provisioning (L1)

- [ ] 10b.1 Test sibling name prefix: ws folder `/a/fo`, session cwd `/a/foo` · resolve · no match (test-plan #E14; see `preferences-store.test.ts`)
- [ ] 10b.2 Test nested folders across workspaces: ws A `/a`, ws B `/a/b`, cwd `/a/b/c` · resolve · ws B wins on longest match (test-plan #E15; see `preferences-store.test.ts`)
- [ ] 10b.3 Test exact folder match: ws folder `/a/b`, cwd `/a/b` · resolve · resolves to that workspace (test-plan #E16; see `preferences-store.test.ts`)
- [ ] 10b.4 Test symlinked cwd: `/tmp/link` → `/a/b/c`, ws folder `/a/b` · resolve real path · resolves to that workspace (test-plan #E17; see `preferences-store-move-folder.test.ts`)
- [ ] 10b.5 Test cwd outside every binding: ws folder `/a/b`, cwd `/x/y` · resolve · no match and not surfaced (test-plan #E18; see `preferences-store.test.ts`)
- [ ] 10b.6 Test allowedRoots narrowing: `allowedRoots=['/srv/ok']`, ws folders `['/srv/ok/p','/home/secret']` · resolve a bind for each · first resolves, second inert with no spawn (test-plan #E19; see `plugin-action-handler.test.ts`)
- [ ] 10b.7 Test resolver precedence with the workspace source: persisted binding + workspace + fixed map + default workspace all applicable · resolve an unbound then a bound channel · persisted binding wins and workspace precedes the fixed map (test-plan #E20; see `plugin-action-handler.test.ts`)
- [ ] 10b.8 Test no create-then-patch window: REST stub recording the call sequence · provision a channel · create call carries the `@everyone` view deny and zero permission-PATCH calls follow (test-plan #X2; see `plugin-action-handler.test.ts`)
- [ ] 10b.9 Test provisioning without overwrite permission: REST stub rejects create-with-overwrites · provision a binding · no channel created and the health entry names the reason (test-plan #X1; see `plugin-enabled.test.ts`)
- [ ] 10b.10 Test synchronous revocation: binding with principal P, REST stub with a delayed overwrite update · remove P and await the config write · at write-success the overwrite is already applied, no interval of retained access (test-plan #X3; see `plugin-action-handler.test.ts`)
- [ ] 10b.11 Test reconciliation failure: REST stub rejects the overwrite update · change a mapping · config write fails with the reason and mapping/access stay consistent (test-plan #X4; see `plugin-action-handler.test.ts`)
- [ ] 10b.12 Test reconcile-at-activation: mapping changed on disk while inactive · activate · overwrites reconciled to the current mapping (test-plan #X5; see `plugin-enabled.test.ts`)
- [ ] 10b.13 Test workspace deleted: bound workspace deleted · seam notification fires · binding inactive, zero channel-delete calls, history untouched (test-plan #X6; see `preferences-store.test.ts`)
- [ ] 10b.14 Test channel deleted on the platform: bound channel deleted · next mirrorable event · binding dropped, session still running, no abort issued (test-plan #X7; see `plugin-action-handler.test.ts`)
- [ ] 10b.15 Test irrelevant workspace fires: `setWorkspaceCollapsed` and a folder reorder · seam notification fires · zero platform calls (test-plan #X8; see `preferences-store.test.ts`)
- [ ] 10b.16 Test coalesced fires: rename + folder-add + rename delivered as one notification · reconcile · converges to the final state and is idempotent under replay (test-plan #X9; see `preferences-store-move-folder.test.ts`)

### 10c. Output filter (L1)

- [ ] 10c.1 Test default level omits structured payloads: file-edit call with args+diff, shell call with output, assistant text · render at names-only · tool names present, args/diff/output absent (test-plan #E24; see `plugin-action-handler.test.ts`)
- [ ] 10c.2 Test forward-only level change: thread with 3 posted messages at names-only · raise to full transcript and emit one event · new event full, prior three unchanged (test-plan #E25; see `plugin-action-handler.test.ts`)
- [ ] 10c.3 Test burst pacing: 100 mirrorable events within 1s to one thread on a stubbed REST clock · measure posts · at most 5 in any 5s window (test-plan #P1; see `plugin-action-handler.test.ts`)
- [ ] 10c.4 Test sustained streaming: continuous event stream for 60s · measure · no 5s window exceeds 5 posts and the stub returns no rate-limit error (test-plan #P2; see `plugin-action-handler.test.ts`)
- [ ] 10c.5 Test one post in flight per thread: event arrives while a post is unresolved · observe concurrency · exactly one in-flight post per thread (test-plan #P3; see `plugin-action-handler.test.ts`)
- [ ] 10c.6 Test assistant-prose boundary: assistant message whose own text quotes a diff · mirror at names-only · prose mirrored verbatim (test-plan #X27; see `plugin-action-handler.test.ts`)
- [ ] 10c.7 Test untiered pull refused: user resolving to no tier requests a diff · process · refused (test-plan #X28; see `plugin-action-handler.test.ts`)
- [ ] 10c.8 Test permitted pull under a names-only filter: `control` principal requests a diff, thread at names-only · process · content delivered (test-plan #X29; see `plugin-action-handler.test.ts`)

### 10d. Question-answer gating (L1)

- [ ] 10d.1 Test observer activation: pending `prompt_request`, principal below `control` · activate the control · no `prompt_response`, session still blocked, interaction still acknowledged (test-plan #X19; see `plugin-action-handler.test.ts`)
- [ ] 10d.2 Test bystander answering: question raised by principal A's command, principal B at `control` · B activates · no `prompt_response` sent (test-plan #X20; see `plugin-action-handler.test.ts`)
- [ ] 10d.3 Test question with no chat invoker: attached session raises a question · any `control` principal on the binding answers · `prompt_response` delivered, no deadlock (test-plan #X21; see `plugin-action-handler.test.ts`)

### 10e. Audit (L1)

- [ ] 10e.1 Test retention at the bound: log holding limit−1 entries with limit 10,000 · append one, then one more · at limit nothing discarded; at limit+1 oldest gone, count equals limit, newest present (test-plan #E21; see `preferences-store.test.ts`)
- [ ] 10e.2 Test default retention: config with no retention key · read the effective limit · 10,000 (test-plan #E22; see `config-redact.test.ts`)
- [ ] 10e.3 Test one entry per action-bearing request: one permitted prompt, one refused prompt, one mirrored event · process all · exactly 2 entries, none for the mirrored event (test-plan #E23; see `plugin-action-handler.test.ts`)
- [ ] 10e.4 Test refusal reasons recorded distinctly: one request per refusal class · process all · each entry carries its own distinct reason (test-plan #X23; see `plugin-action-handler.test.ts`)
- [ ] 10e.5 Test provenance persists: session first driven from chat · restart the dashboard · the plugin-owned ref survives naming principal+channel+binding, user tag namespace untouched (test-plan #X24; see `plugin-enabled.test.ts`)
- [ ] 10e.6 Test the log has no edit path: existing log entries · enumerate the layer's exposed interface · no edit or delete operation exists (test-plan #X25; see `plugin-action-handler.test.ts`)
- [ ] 10e.7 Test the log is unreachable from chat: `operate` principal asks the bot for the log · process · refused and redirected to the dashboard with no log content posted (test-plan #X26; see `plugin-action-handler.test.ts`)

### 10f. Host workspace seam (L1)

- [ ] 10f.1 Test defensive copy: `listWorkspaces()` result · mutate the array and a nested `folders` array · store unchanged and a re-read returns original state (test-plan #E26; see `preferences-store.test.ts`)
- [ ] 10f.2 Test empty state: no workspaces configured · `listWorkspaces()` · empty collection with no throw (test-plan #E27; see `preferences-store.test.ts`)
- [ ] 10f.3 Test every mutator notifies: subscriber registered, all 9 store mutators · invoke each in turn · 9 notifications, one per mutator (test-plan #E28; see `preferences-store.test.ts`)
- [ ] 10f.4 Test the completeness guard: notification wiring removed from one mutator · run the guard · guard fails naming that mutator (test-plan #E29; see `preferences-store.test.ts`)
- [ ] 10f.5 Test unsubscribe: subscriber that has unsubscribed · mutate a workspace · handler not invoked (test-plan #E30; see `plugin-enabled.test.ts`)
- [ ] 10f.6 Test throwing subscriber: two subscribers where the first throws · mutate a workspace · second still notified and the mutation persists (test-plan #X22; see `plugin-enabled.test.ts`)
- [ ] 10f.7 Test additivity: a plugin written before the seam existed · load it · activates unchanged with no context member shape change (test-plan #X30; see `plugin-enabled.test.ts`)

### 10g. Configuration surface (L3 Playwright, docker harness)

- [ ] 10g.1 Spec the delegation list: binding with a role mapped `control` assignable by a non-owner · open the config surface · converges to showing the mapping alongside those members (test-plan #F1; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10g.2 Spec delegation unavailable: stubbed platform lacking member enumeration · open the config surface · states the list is unavailable and names the missing permission, never an empty list (test-plan #F2; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10g.3 Spec inert workspace folders: bound workspace with one folder inside and one outside `allowedRoots` · open the config surface · the outside folder shows as inert (test-plan #F3; see `tests/e2e/blackhole-settings.spec.ts`)
- [ ] 10g.4 Spec disarmed state visible: layer disarmed from chat · open the config surface · shows disarmed with a re-arm control (test-plan #F4; see `tests/e2e/blackhole-settings.spec.ts`)
- [ ] 10g.5 Spec log view ordering: 3 log entries written in known order · open the log view · rendered most-recent-first (test-plan #F5; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10g.6 Spec config immutability from chat: config surface open with a chat-originated mutation attempt in flight · attempt it · rendered config values unchanged (test-plan #F6; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10g.7 Spec elision marker rendering: assistant message exceeding the platform message limit · mirror it · thread shows an explicit elision marker (test-plan #F7; see `tests/e2e/blackhole-settings.spec.ts`)

### 10h. Manual-only (deferred post-merge, no test folded)

- [ ] 10h.1 End-to-end team flow against a real test guild: bind a workspace, prompt as `control`, attempt as `observe`, revoke a principal, disarm (test-plan: manual-only #M1)
- [ ] 10h.2 Config surface comprehensibility: an operator reads a panel with 3 bindings and mixed mappings cold and can tell who can do what, where (test-plan: manual-only #M2)

### 10i. Test infra

- [ ] 10i.1 Extend chat-gateway's adapter stub into a Discord REST/gateway fixture that records the full call sequence (required by the create-then-patch and rate-budget rows), and verify it captures create-call payloads and post timestamps
