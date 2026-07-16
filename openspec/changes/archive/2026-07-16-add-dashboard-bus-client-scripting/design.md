# Design — dashboard bus-client + scripting layer

## Context

The dashboard runs on a bidirectional WebSocket bus. Protocol unions in
`packages/shared/src/{protocol,browser-protocol}.ts`:

- `BrowserToServerMessage` (75) — the client's command verbs.
- `ServerToBrowserMessage` (66) — events + replies to the client.
- `ServerToExtensionMessage` (39) / `ExtensionToServerMessage` (35) — server↔bridge.

REST (`server/src/routes/*`, ~153 paths) is a facade in front of the same core.
The web client already sends core session verbs over the bus; REST command
endpoints are consumed by the curl skill + smoke tests, not the UI.

**Doubt-review corrections folded in (both single- and cross-model):** the
generic-plugin claim, three Tier-2 rows, the requestId claim, the codegen claim,
the snapshot-read claim, and the headless-auth coupling were all found overstated
against source and are corrected below.

## The topology

```
  script / web client ──WS: BrowserToServerMessage (75 verbs)──▶ SERVER ──WS──▶ BRIDGE (pi)
        ▲                                                          │  ServerToExtensionMessage
        └──WS: ServerToBrowserMessage (events, replies) ──────────┘
        REST /api/* ──────────────────────────────────────────────┘  (facade; reuses same core)
```

## The client surface

```ts
interface BusClient {
  connect(opts?): Promise<void>;                 // port discovery + ws ticket + subscribe
  send<T extends BrowserToServerMessage>(m: T): void;
  until(sessionId: string, status: SessionStatus, o?: {timeout?: number}): Promise<void>;
  await<E extends ServerToBrowserMessage>(pattern: Partial<E>, o?): Promise<E>;
  read: {
    sessions(): DashboardSessionMeta[];          // registry metadata + status (snapshot)
    session(id): DashboardSessionMeta | undefined;
  };
  spawn(o: {cwd; attachProposal?; initialPrompt?}): Promise<string>; // exact-correlated
  resume(o): Promise<string>;                    // exact-correlated (resume_result.requestId)
  prompt(sessionId, text, o?): void;
  plugin(pluginId, action, payload?): void;      // plugin_action — goal-plugin only (today)
}
```

### Correlation strategy (corrected)

- **Exact** — only where a correlation id actually exists in the protocol:
  `spawn_session` → `session_added.spawnRequestId`, and
  `resume_session` → `resume_result.requestId`.
- **Structural** — everything else (prompt turn completion, model set, etc.): key
  on `sessionId` + the target `SessionStatus` transition observed on the
  subscription stream. Concurrency across sessions is safe because every wait is
  keyed by session id.
- **NOT available** — `request_models`/`request_providers`/`request_roles` carry
  **no** `requestId` and broadcast `*_list` to all subscribers; the client cannot
  exact-await them. It reads their results from the broadcast by structural match,
  or the caller uses the REST twin. (Adding optional `requestId` fields to these
  is out of scope here.)

### Verb codegen (corrected)

Codegen enumerates `BrowserToServerMessage` **minus a forwardable-command
allowlist/denylist**. Some union members are NOT forwarded over the WS — e.g.
`plugin_config_write` is intercepted in the client's plugin `send` and routed to
`POST /api/config/plugins/:id` (asserted by
`client/src/lib/__tests__/plugin-config-write.test.ts`). Naive codegen from the
raw union would emit a helper that silently fails. The generator therefore:

1. Enumerates the union (via a TS compiler-API / `ts-morph` pass).
2. Excludes members on the client-intercepted denylist.
3. A completeness test asserts every *generated* verb resolves to a server-side
   handler (a `browser-gateway` switch case or a plugin `registerBrowserHandler`),
   failing CI if a generated verb has no receiver.

### Reads (corrected — snapshot is metadata only)

`read.sessions()`/`read.session(id)` return `DashboardSession` registry fields
(id, cwd, name, status, model, thinkingLevel, tokens, cost, gitBranch,
openspecPhase, attachedProposal, tags, …) from `sessions_snapshot` plus live
deltas — the same stream `until`/`await` watch, so reads and waits never
split-brain. The snapshot does **not** carry chat history or the agent's last
response (those arrive via `event`/`event_replay`); a chat-read primitive is a
follow-up, not part of this `read` API.

```
  ✓ unified: subscribe ─ WS ─▶ live snapshot + deltas   read (meta+status) and wait agree
```

### Auth for a headless client (corrected — coupling stated)

`connect()` on loopback: `POST /api/ws-ticket` passes `networkGuard`
(loopback/trusted) → mint a single-use ticket (`ws-ticket.ts`, TTL 15 s) → open
the WS within the window → subscribe. **Off-box / untrusted network** requires a
paired-device bearer (`bearer-auth.ts`), which depends on the pairing surface —
out of scope for MVP (loopback-only). The client surfaces a clear error rather
than pretending off-box works.

## Migration scope

### Tier 1 — LLM-facing curl layer → bus client (this change)

| Path | Change |
|---|---|
| `extension/.pi/skills/pi-dashboard/scripts/dashboard-api.sh` | wrap bus client, not curl |
| `extension/.pi/skills/pi-dashboard/commands/*.md` (~35 slash cmds) | invoke bus client wrapper |
| `extension/.pi/skills/pi-dashboard/SKILL.md` + `references/{recipes,api-reference}.md` | teach typed `.ts` authoring |
| `.pi/skills/debug-dashboard/scripts/{list-sessions,health-probe}.ts` | read from subscription snapshot |

### Tier 2 — only REST twins with a real WS verb (bounded, corrected)

**Moves** (verb exists in `BrowserToServerMessage`, forwarded over WS):
- session/flow command wrappers already backed by WS verbs: `abort`,
  `send_prompt`, `spawn_session`, `resume_session`, `flow_control`, `set_model`,
  `set_thinking_level`, `rename_session`, `hide/unhide`, `attach/detach_proposal`.
- `plugin("goal", …)` for goal-plugin mutations that route through its working
  `plugin_action` handler.

**Stays REST** (no WS twin — do NOT invent verbs here):
- `plugin_config_write` (intercepted to REST by design + test), `canvas-types`
  writes (server-push only), `openspec/tasks/toggle` (no toggle verb).
- `goal-plugin`/`kb-plugin`/`automation-plugin` non-goal REST operations, and all
  read-only wrappers (`git-api` 52 refs, `grep`, `browse`, `doctor`).
- flows/kb/automation `plugin_action` → blocked on the follow-up change.

### Tier 3 — leave HTTP (non-goals)

model-proxy `/v1/*`, auth, pairing, tunnel, recovery-server, mDNS, electron
probes, stateless computed reads, `server/src/routes/*` implementations.

## The DRY payoff

```
                 @pi-dashboard/bus-client  (imports shared protocol; verbs codegen'd w/ denylist)
        ┌──────────────────┬──────────────────────┐
        ▼                  ▼                      ▼
  scripting engine   pi-dashboard skill     web client (bounded Tier 2)
  (LLM writes .ts)   dashboard-api.sh +     session/flow command mutations
                     ~35 slash cmds wrap it ride the WS it already holds
```

## Dependency: the follow-up change

`fix-plugin-action-fanout-and-handlers` (separate proposal) makes `plugin_action`
a true universal seam: (1) change `browser-gateway` `customHandlers` from
last-writer-wins `Map<string,Handler>` to a pluginId-keyed fan-out so multiple
plugins can service `plugin_action`; (2) add real `plugin_action` handlers to
flows/kb/automation. Once it lands, `bus-client.plugin(id, …)` reaches every
extension. This change does **not** depend on it shipping first — it degrades to
goal-only until then.

## Alternatives considered

- **Keep curl, add higher-level bash verbs.** Rejected: no type safety, no native
  waits, still 153 heterogeneous paths, wrong (facade) seam.
- **Server-hosted `POST /api/script` executor.** Deferred: new stateful server
  subsystem + security surface. A client-side ticketed WS is the smaller MVP.
- **Do the plugin_action fan-out inline.** Rejected per Option 3: it touches 4
  plugins + the gateway registry; split to keep this change shippable.
- **A new declarative DSL now.** Deferred (Open Question 1): typed TS is
  LLM-native, full-power, needs no interpreter.

## Risks

- **Blast radius.** Bus verbs kill processes / remove worktrees / spawn agents.
  Mitigation: read-vs-mutate verb tiers, ticket auth, loopback-only MVP,
  `--dry-run` prints the envelope stream without sending. (`security-hardening`.)
- **Tier 2 regression.** Moving live client mutations off REST could break a UI
  path. Mitigation: per-wrapper, behind existing tests; `doubt-driven-review`
  before each twin flips.
- **Codegen drift / broken helpers.** Mitigation: denylist + the
  every-generated-verb-has-a-handler completeness test.
- **Goal-only plugin support surprises a scripter.** Mitigation: `plugin()`
  errors clearly for unhandled pluginIds until the follow-up lands.
