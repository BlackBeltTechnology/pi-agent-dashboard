## MODIFIED Requirements

### Requirement: Generic session-ownership seam on `ServerPluginContext`

`ServerPluginContext` SHALL expose a generic session-ownership seam so any plugin can stamp its own identity onto a session it spawns, without core naming the plugin. When a plugin spawns a session, it files an opaque `pluginRef` — a plugin-namespaced value core carries but never parses — plus an optional lifecycle declaration `{ recover?: boolean; finalizeOnSocketClose?: boolean; hidden?: boolean; archiveOnEnd?: boolean; close?: { idle?: { afterMs: number }; mode?: "sleep" | "archive" } }` (the `close` block is specified by capability `plugin-session-close-hook`). When the spawned session registers, the host resolves the ref and notifies the owning plugin.

Core SHALL NOT read the interior of `pluginRef`. Core SHALL make lifecycle decisions only from the declared `{ recover, finalizeOnSocketClose, hidden, archiveOnEnd, close }` values, never from the plugin's name, from any field inside `pluginRef`, or from the presence of an owner ref. Core MAY record the declaring plugin's id with a `close` declaration and use it only to route that plugin's session closer and to authorize that plugin's close requests; this routing is not a lifecycle decision and SHALL NOT read `pluginRef`.

The first-party features `automation` and `goal` SHALL each own their identity through this seam as ordinary contributions (built-ins are peers, not privileged): `automation` files `{ kind: "automation", automationRun: {...} }`, `goal` files `{ goalId }`. The emitted `.meta.json`, wire protocol, and `DashboardSession` field names and values SHALL be byte-identical to before this change, except that a session whose owner declares `recover: false` gains that single additive core-owned boolean (see the recovery requirement); user sessions never carry it and stay byte-identical.

`pluginRef` SHALL be boundary-validated on receipt, following the publish/collect doctrine's fail-open rule: core SHALL accept only a plain object, SHALL reject (drop + warn once, without throwing) a malformed ref, and SHALL NOT let a ref overwrite a reserved session field it does not own. A plugin's ref merges only the keys that plugin owns; it cannot set another plugin's `goalId`/`automationRun` or a core-reserved field.

#### Scenario: Trusted plugin ends a session like the Shutdown control

- **WHEN** a trusted plugin (manifest `priority <= 100`) calls `ctx.shutdownSession(sessionId)` for a known session
- **THEN** the host SHALL run the same shutdown the browser `shutdown` message and `POST /api/session/:id/shutdown` run, and resolve `true`
- **AND** an untrusted plugin, or an unknown session, SHALL get `false` with no effect

#### Scenario: Declared hidden keeps the session off the board

- **WHEN** a plugin spawns a session with `lifecycle: { hidden: true }` and the session registers via its spawn token
- **THEN** core SHALL set the session `hidden = true`, broadcast the update, and record the core-owned `pluginHidden` intent
- **AND** core SHALL NOT re-apply it on a later reattach, so the hide survives restarts without overriding an operator's choice

#### Scenario: Malformed ref is dropped fail-open

- **WHEN** a plugin files a non-object or otherwise malformed `pluginRef`
- **THEN** core SHALL drop it and warn once for that key, without throwing
- **AND** the session SHALL register with no owner ref rather than crashing the spawn

#### Scenario: Ref cannot overwrite a field it does not own

- **WHEN** a plugin files a ref containing a reserved key it does not own (e.g. another plugin's `goalId`)
- **THEN** core SHALL NOT apply that key to the session

#### Scenario: Plugin files an opaque ref and is notified on register

- **WHEN** a plugin spawns a session through the seam with a `pluginRef` and the session later registers
- **THEN** the owning plugin SHALL be notified with its own `pluginRef` and the resolved sessionId
- **AND** core SHALL NOT have parsed the interior of that `pluginRef`

#### Scenario: Two plugins own two sessions independently

- **WHEN** two different plugins each spawn a session with their own `pluginRef`
- **THEN** each plugin SHALL be notified only for its own session, with its own ref

#### Scenario: Emitted keys are unchanged

- **WHEN** `automation` files `{ kind: "automation", automationRun }` and `goal` files `{ goalId }` through the seam
- **THEN** the resulting `.meta.json` and `DashboardSession` SHALL carry the same `kind` / `automationRun` / `goalId` field names and values as before this change

#### Scenario: Close declaration routes only to its declaring plugin
- **WHEN** plugin A spawns a session with a `close` declaration and plugin B has registered a session closer
- **THEN** only plugin A's closer SHALL be consulted for that session
- **AND** core SHALL NOT read the session's `pluginRef` to decide this
