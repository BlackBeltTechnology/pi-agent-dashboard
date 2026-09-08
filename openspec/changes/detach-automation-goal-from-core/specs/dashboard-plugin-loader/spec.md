## ADDED Requirements

### Requirement: Generic session-ownership seam on `ServerPluginContext`

`ServerPluginContext` SHALL expose a generic session-ownership seam so any plugin can stamp its own identity onto a session it spawns, without core naming the plugin. When a plugin spawns a session, it files an opaque `pluginRef` — a plugin-namespaced value core carries but never parses — plus an optional lifecycle declaration `{ recover?: boolean; finalizeOnSocketClose?: boolean }`. When the spawned session registers, the host resolves the ref and notifies the owning plugin.

Core SHALL NOT read the interior of `pluginRef`. Core SHALL make lifecycle decisions only from the declared `{ recover, finalizeOnSocketClose }` values, never from the plugin's name, from any field inside `pluginRef`, or from the presence of an owner ref.

The first-party features `automation` and `goal` SHALL each own their identity through this seam as ordinary contributions (built-ins are peers, not privileged): `automation` files `{ kind: "automation", automationRun: {...} }`, `goal` files `{ goalId }`. The emitted `.meta.json`, wire protocol, and `DashboardSession` field names and values SHALL be byte-identical to before this change, except that a session whose owner declares `recover: false` gains that single additive core-owned boolean (see the recovery requirement); user sessions never carry it and stay byte-identical.

`pluginRef` SHALL be boundary-validated on receipt, following the publish/collect doctrine's fail-open rule: core SHALL accept only a plain object, SHALL reject (drop + warn once, without throwing) a malformed ref, and SHALL NOT let a ref overwrite a reserved session field it does not own. A plugin's ref merges only the keys that plugin owns; it cannot set another plugin's `goalId`/`automationRun` or a core-reserved field.

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

### Requirement: Core lifecycle decisions read a generic flag, not the plugin name

Core lifecycle decisions SHALL be derived from a generic core-owned flag, never from a hardcoded `kind === "automation"` branch, never from the plugin's name, and never from reading or detecting an owner ref. Core SHALL contain no branch that names a specific plugin, and no branch that reads `pluginRef` or enumerates owner keys, to make a lifecycle decision.

**Recovery (cold start).** Recovery candidacy SHALL be governed by a single core-owned boolean `recover` on the session sidecar, defaulting to `true` when absent. `isRecoveryCandidate` SHALL read `meta.recover !== false`, replacing the `kind !== "automation"` guard. Core SHALL NOT read `pluginRef`, enumerate owner keys, or test for owner-ref presence to make this decision. A plugin that owns a session and does not want it replayed SHALL declare `recover: false`; core persists that resolved boolean onto the sidecar. Because the predicate already requires `live && status !== "ended"`, a session closed normally (not live / `ended`) is never a recovery candidate regardless of `recover`; the persisted `recover: false` only governs the crash window where an owned session is still `live && !ended`. User sessions never carry the field (absent ⇒ recoverable) and stay byte-identical; only an owned session that opts out gains the additive `recover: false` byte. Both first-party features `automation` and `goal` SHALL declare `recover: false` through this same generic field — neither is named in core, and their opt-out is symmetric.

**Socket-close finalization.** A session whose owner declares `finalizeOnSocketClose: true` SHALL be finalized on socket close; a session with no such declaration SHALL NOT be. Core reads the declared value, not the plugin name.

#### Scenario: Owned session in the crash window is not a recovery candidate

- **WHEN** cold-start recovery scans a still-`live`, non-`ended` session whose sidecar carries `recover: false`
- **THEN** `isRecoveryCandidate` SHALL return false for it
- **AND** the decision SHALL read only the core-owned `recover` flag, referencing no plugin name and no owner ref

#### Scenario: Both first-party features opt out through the same flag

- **WHEN** the `automation` and `goal` contributions are inspected
- **THEN** each SHALL declare `recover: false` through the same generic lifecycle field
- **AND** core SHALL treat both identically, naming neither

#### Scenario: Unowned session recovery is unchanged

- **WHEN** cold-start recovery scans a still-`live` session whose sidecar carries no `recover` field
- **THEN** `isRecoveryCandidate` SHALL treat it as `recover !== false` and return the same verdict it returned before this change

#### Scenario: finalizeOnSocketClose:true session finalizes on socket close

- **WHEN** a session whose owner ref declares `finalizeOnSocketClose: true` loses its socket
- **THEN** core SHALL run the finalization path
- **AND** a session that made no such declaration SHALL NOT be finalized on socket close

#### Scenario: No plugin name remains in a core lifecycle branch

- **WHEN** the core recovery and finalization paths are inspected
- **THEN** neither SHALL contain a literal `"automation"` (or any other plugin name) as a lifecycle condition

### Requirement: `automationRun` is removed from the generic plugin API surface

The generic plugin runtime surface (`ServerPluginContext` / `server-context.ts`) SHALL NOT expose an `automationRun` field. Automation-specific identity SHALL travel only inside `automation`'s own `pluginRef`, not on the shared context type every plugin sees.

#### Scenario: automationRun absent from the generic context type

- **WHEN** the `ServerPluginContext` surface is inspected
- **THEN** it SHALL NOT declare an `automationRun` field
