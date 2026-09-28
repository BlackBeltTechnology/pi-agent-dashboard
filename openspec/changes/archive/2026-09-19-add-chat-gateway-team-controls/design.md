## Context

See `proposal.md` — Why and Dependency. This design covers only the team-control layer; `add-chat-gateway/design.md` owns placement, the adapter, the headless-client seam, and the `allowedRoots` threat model.

Host facts, each verified in source:

- `ServerPluginContext` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:622`) exposes `onEvent`, `onSessionEnded`, `onSessionResolved`, `sendToSession`, `sendExtensionMessage`, `spawnSession`, `abortSession`, `assignSessionRef`, `getPluginConfig` / `updatePluginConfig`, `registerBrowserHandler`, `registerWsRoute`, `provide` / `consume`, `onShutdown`, `fastify`.
- **Trust is `manifest.priority <= 100`** (`packages/server/src/server.ts:2372`); the loader default is `1000` (`loader.ts:207`). Untrusted plugins get silent no-ops on session-affecting verbs.
- **Workspaces are not plugin-reachable.** `grep -c preferences server-context.ts` → `0`; no workspace route in `route-tiers.ts`; `workspaces_updated` goes to browser WS clients only. The store (`packages/server/src/persistence/preferences-store.ts`) owns **nine** workspace mutators: `createWorkspace`, `renameWorkspace`, `deleteWorkspace`, `setWorkspaceCollapsed`, `addFolderToWorkspace`, `removeFolderFromWorkspace`, `moveFolderToWorkspace`, `reorderWorkspaceFolders`, `reorderWorkspaces`.
- `addFolderToWorkspace` and `moveFolderToWorkspace` enforce a **single-membership invariant** (a path is removed from every other workspace first), so one folder cannot belong to two workspaces.
- **The effective verb-tier table is `GENERATED_TOOLS`** (`mcp-server-plugin/src/server/generated/tools.ts`, re-exported from the package's `./manifest` entry), *not* `MANIFEST`: on `ToolRow`, `tier` is optional — "Required for context/session rows; optional (>= route) for rest" — and only 12 of 156 rows declare one. Every `GENERATED_TOOLS` row carries a tier. Bind kinds there: 148 `rest`, 4 `context`, 4 `session`.
- `assignSessionRef(sessionId, ref, { persist })` merges a plugin-owned ref, persisting by default — the right vehicle for provenance. `set_session_tags` is also reachable (a `session`-bind row) but is the human-curated tag namespace.
- Plugin config supports write-only redaction (`config-redact.ts`), and `plugin_config_update` broadcasts to **browsers only** — a server plugin gets no config-change notification from the host.

## Goals / Non-Goals

**Goals:**
- One authorization chokepoint, resolving against one tier table shared with the MCP surface.
- A binding unit a team already thinks in (a workspace), with a channel that is private from birth.
- A default output posture that does not leak a repo into a room.
- A layer that can only *narrow* chat-gateway's existing boundaries, never widen them.

**Non-Goals:**
- No transport, adapter, routing table, or interactive rendering — chat-gateway owns those.
- No second gateway connection and no second Discord plugin.
- The plugin never mutates a workspace, never deletes a channel, never deletes a session.
- No sharding, no multi-guild, no live-guild CI test.

## Decisions

### D1 — Ship inside chat-gateway's plugin, not as a second plugin

Two plugins each holding a gateway connection to one guild would double-post every mirrored event, split the routing table, and race on channel provisioning. The team-control layer is therefore modules inside chat-gateway's package, consumed at its authorization and output boundaries.

*Consequence:* this change's spec deltas include `MODIFIED` requirements on the `chat-gateway` capability. That is the honest shape — it changes how chat-gateway authorizes, rather than wrapping it from outside.

### D2 — One chokepoint, returning a reasoned result, layered under L1/L2

```
chat-gateway L1 (allowlisted?) ─▶ L2 (admin, for binding) ─▶ THIS LAYER
                                                                │
authorize(message|interaction, verb) -> Grant | Refusal         ▼
  1. author.bot || webhook_id            -> Refusal("non_human_author")   [first, hard]
  2. binding for this channel?           -> Refusal("unbound_channel")
  3. per-binding snowflake entry         -> tier?
  4. per-binding role map (max, ≤control)-> tier?
  5. none matched                        -> Refusal("no_principal_mapping")
  6. max(tier), clamped to ceiling
  7. target session outside binding scope-> Refusal("scope_violation")
  8. disarmed && action-bearing verb     -> Refusal("disarmed")
  9. verb ∈ NON_DELEGABLE                -> Refusal("non_delegable_verb")
 10. tierOf(verb) > resolved tier        -> Refusal("insufficient_tier")
                                         -> Grant{tier, binding, verb}
```

- **A discriminated result, not `Tier | null`.** The audit requirement is a *specific* reason per refusal; a nullable tier collapses seven distinct refusals into one value.
- **Scope containment is inside the chokepoint** (step 7), not a separate check next to it. A containment check that lives elsewhere is a containment check someone forgets to call.
- **Per-binding mappings, never global.** A global table would grant every listed principal access to a channel the moment it is provisioned — the opposite of fail-closed.
- **Layered, never widening.** This function can only refuse. A principal chat-gateway's L1 already rejected never reaches it.

`NON_DELEGABLE` is a module constant: `mint_device_token`, `set_providers`, `install_package`, `tunnel_connect`. The Discord command table is a curated allowlist of verbs (D3), so `shutdown_server`-class verbs are absent by construction rather than by deny-list — worth stating, because a chat-driven shutdown would take down the audit log and the disarm switch with it.

`authorize` is pure over `(author, roles, config, binding, verb, targetCwd)`.

### D3 — Verb tiers read from `GENERATED_TOOLS`; a curated command allowlist

The bridge's command table maps each chat command to a verb *name*; the tier comes from that verb's `GENERATED_TOOLS` row.

*Not `MANIFEST`* — its `tier` is absent on 144 of 156 rows (rest rows derive from `ROUTE_TIERS`), so reading it and refusing tier-less verbs would refuse `resume_session` and every other derived-tier verb. Recomputing the derivation locally would create a third tier table, which is what this decision exists to prevent.

Execution stays chat-gateway's: it drives sessions as a headless browser-protocol client. This layer decides *whether*, never *how*. A verb absent from the command allowlist is refused even if a principal's tier would permit it.

### D4 — Host seam: read-only, store-anchored, over-fire tolerant

- `listWorkspaces(): { id, name, folders }[]` — a defensive copy.
- `onWorkspacesChanged(handler): () => void` — returns an unsubscribe fn.

**Anchored on all nine preferences-store mutators, not on `broadcastWorkspaces()`.** The broadcast is one transport's presentation layer; anchoring there makes the seam's correctness depend on an unstated "every future mutation path must also broadcast" invariant. Anchoring on the store is what makes the seam true by construction — and the mutator list must be complete, including `moveFolderToWorkspace` (the one that drives the folder-membership case), `reorderWorkspaceFolders`, and `reorderWorkspaces`.

**The notification is a coalescable hint, not a diff.** It may fire for changes the consumer does not care about (`setWorkspaceCollapsed`, reorders) and may coalesce bursts. Consumers re-read via `listWorkspaces()` and reconcile idempotently — which also means a mutator added later cannot silently break a consumer.

Read-only and not trust-gated: no mutation path. It does expose workspace names and groupings, which are not inferable from session cwds — so the safety argument is "no mutation and no secret", not "no new information".

### D5 — Manifest priority `100`, with failure made observable at the call site

The plugin declares `priority: 100` so the host admits it to `assignSessionRef`, `sendExtensionMessage`, and `abortSession`.

Side-effect-free trust probes do exist (`spawnSession` refuses untrusted *before* validating opts; `mintSpawnToken` throws for untrusted), so a startup self-check is possible. It is still not the mechanism chosen: a probe asserts trust at time T, while what matters is the verb that no-ops at time T+n. So the rule is **call-site detection** — a trusted-gated verb returning the no-op result marks the plugin unhealthy naming the missing trust level and refuses the originating command with that reason, instead of reporting a phantom success.

### D6 — Two stores plus an append-only log

| Data | Store | Why |
|---|---|---|
| per-binding principals + role maps, ceiling, mirror levels, disarm flag | plugin config | operator-authored, persisted, redactable |
| workspace↔channel bindings | plugin-owned JSON store | mutates outside operator edits |
| command log | append-only file, ring-buffer bound (operator-configurable, **default 10,000 entries**) | audit needs a store with no edit path |

Session↔thread mapping is **not** stored here — chat-gateway's routing table owns it.

**Config-change detection:** the host broadcasts `plugin_config_update` to browsers only, so the layer gets no notification. Overwrite reconciliation (D7) therefore triggers on the layer's *own* config-write path, plus a reconcile sweep at activation to catch any edit made while the dashboard was down. Polling was rejected: a permission revocation that takes effect "within a minute" is not a revocation.

**Reconciliation is synchronous with the config write** — the write does not return until the platform overwrites match the new mapping. There is therefore no window in which a removed principal still has read access, and the observable is "no window" rather than a latency bound. Cost, accepted: a settings save takes as long as a platform API round-trip, and a failed reconcile fails the save (surfacing the problem) instead of silently leaving access in place.

### D7 — Channel provisioning in one call; overwrites reconciled on change

The create payload carries `permission_overwrites` denying `@everyone` VIEW_CHANNEL — Discord has no transactional create-then-permission, and a create-then-PATCH sequence has a world-readable window. If the bot cannot set overwrites, **no channel is created**; a visible failure beats a leaky success.

Creation-time overwrites alone are insufficient: removing a principal from the mapping would leave their `VIEW_CHANNEL` in place, and mirroring is not per-principal, so an ex-principal would keep reading. Hence synchronous reconciliation on every mapping change (per D6).

Deletion never propagates: workspace deleted → binding inactive, channel and history stay; channel deleted in Discord → binding dropped, sessions untouched.

### D8 — Workspace binding narrows `allowedRoots`, never widens it

A workspace is a *source* for chat-gateway's cwd resolver, inserted at the same precedence as its fixed channel→cwd map — and subject to the identical `allowedRoots` containment check, real-path resolution included. A workspace folder outside `allowedRoots` is **refused, not adopted**.

This is the load-bearing invariant of the whole change: `allowedRoots` is chat-gateway's spawn boundary and its stated threat-model control. A convenience feature that silently extended it would dissolve that control, and the operator would have no way to notice. The settings surface shows, per bound workspace, which of its folders are outside `allowedRoots` and therefore inert.

Resolution of a session cwd to a workspace resolves symlinks, matches on **segment boundaries** (`/a/b` does not match `/a/bc`), and takes the **longest** match. A same-folder-in-two-workspaces conflict needs no handling: the store's single-membership invariant makes it unreachable.

### D9 — Output filter is a per-thread buffered reducer, with an honest limit

Events → filter by mirror level → coalesce → post, one in-flight post per thread. **The budget ceiling is Discord's documented per-channel limit of 5 messages per 5 seconds**; the coalesce window is derived from it rather than picked independently, so the pacing cannot drift from the platform's actual limit. Dropped or shortened content carries an explicit elision marker.

**Stated limit:** the filter bounds *structured payloads* — tool arguments, tool results, diffs, terminal output. It cannot bound assistant prose, which may quote a diff verbatim. Scrubbing prose was considered and rejected: an unreliable scrubber is worse than an honest boundary, because it invites trust it cannot earn. Spec, settings copy, and docs state the boundary; the privacy posture rests on channel membership.

Mirror level governs the passive stream only; explicitly pulled content is tier-gated, or the filter would be a privacy control a pull command walks past.

### D10 — Question answering is gated, not rendered, here

chat-gateway renders `prompt_request` as native controls, defers within 3s, and handles `prompt_dismiss`. This layer contributes exactly one thing: **who may answer**. At least `control`; invoker-only when the question arose from a specific principal's command; any `control` principal on the binding when no Discord user invoked it — otherwise an autonomous session's question would deadlock waiting for an invoker who does not exist.

Exactly-once, cross-surface dismissal, and reconnect replay are chat-gateway's PromptBus machinery and are not respecified.

### D11 — Provenance via `assignSessionRef`

`ctx.assignSessionRef(sessionId, ref, { persist })` merges a plugin-owned ref, trusted-gated (D5) and persisted by default. Provenance records the invoking snowflake, the channel, and the binding.

*Not* `set_session_tags` — reachable, but it is the tag namespace a human curates in the UI. Writing machine provenance there would let a user edit or delete an audit record and would collide with their own tags.

## Risks / Trade-offs

- **D2 is the authorization surface for code execution** → pure function, table-driven tests over every refusal reason including `scope_violation`, `doubt-driven-review` before it stands.
- **Coupling to `GENERATED_TOOLS`** → a verb rename breaks the build, which is the intended failure direction; a test asserts every allowlisted command resolves to a tier.
- **Living inside chat-gateway's package** (D1) → this change cannot land before it; in exchange there is one gateway connection, one routing table, one settings surface.
- **Config-change reconciliation depends on the layer owning its write path** (D6) → a config edited by any other means reconciles only at next activation; stated, and the settings surface is the only supported editor.
- **`allowedRoots` narrowing must hold everywhere** (D8) → enforced in the resolver, not at the UI; a test asserts a workspace folder outside `allowedRoots` never produces a spawn.
- **Assistant prose can leak what the filter forbids** (D9) → stated boundary, not a scrubber. Mitigated, not solved.
- **Mirrored content is retained and indexed by Discord** → minimal default, per-binding tuning, explicit docs. Mitigated, not solved.
- **Guild permission drift** → settings names who can assign each mapped role; tier re-resolved per message; overwrites reconciled on mapping change.
- **Host seam breadth** (D4) → read-only, additive, store-anchored, over-fire tolerant so future mutators cannot silently break consumers.

## Migration Plan

Additive and opt-in on top of chat-gateway. With no principal mappings configured, every bound channel grants nobody anything — enabling the layer cannot widen access, only narrow it. The one host change (D4) is an additive read-only context member; existing plugins need no update.

*Rollback:* remove the principal mappings and the layer is inert (fail-closed default means chat-gateway's own L1/L2 posture governs again). Bindings persist; channels and history remain (D7's never-delete rule), so re-enabling reattaches. The host seam is inert with no consumer.

## Open Questions

- Whether mirror level should also be settable per-thread. Per-binding is specified; per-thread is additive.
- Channel-name disambiguation when two workspaces share a display name — an implementation detail of D7.
