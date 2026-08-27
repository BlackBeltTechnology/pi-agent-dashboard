## ADDED Requirements

### Requirement: Host exposes a per-plugin, cwd-keyed capability policy registry

The host SHALL provide a `CwdPolicyRegistry` with `registerCwdPolicy(cwd, policy)`, `unregisterCwdPolicy(cwd)`, and `resolveCwdPolicy(cwd)`. Registry entries SHALL be keyed by the pair `(owningPluginId, canonicalCwd)`, where `canonicalCwd` is computed by resolving the LONGEST EXISTING ancestor of `cwd` through the real filesystem path (`fs.realpathSync`) and appending any not-yet-existing trailing segments lexically (on Windows, case-folded) so a policy for a not-yet-created dir under a symlinked ancestor keys to the same canonical prefix the spawn will resolve to. A single registry instance SHALL be wired into BOTH the spawn funnel and every plugin `ServerPluginContext`, so no spawn path or context observes a different registry.

`registerCwdPolicy` and `unregisterCwdPolicy` SHALL be exposed on the plugin `ServerPluginContext`, gated to first-party / trusted plugins by the same trust gate as `spawnSession`; an untrusted plugin SHALL receive a no-op hook that registers nothing.

The **plugin-facing** `registerCwdPolicy` SHALL accept ONLY the tightening fields (`tools`, `excludeTools`, `noBuiltinTools`, `noTools`, `skills`, `noSkills`). If a plugin supplies `extensions` / `extensionConfig`, the registration SHALL be REJECTED with an observable error and SHALL register nothing — it SHALL NOT silently drop the fields and store a no-op policy (a silent drop makes a failed registration indistinguishable from success). (Extension-injecting policies come only from the deferred ops-config source; a plugin loading code into sessions it did not spawn is a privilege expansion the `priority<=100` gate cannot authorize.)

#### Scenario: Register then resolve
- **WHEN** a trusted plugin calls `registerCwdPolicy("/w/secrets", { noTools: true })` and a spawn resolves cwd `/w/secrets`
- **THEN** `resolveCwdPolicy("/w/secrets")` SHALL return a composed policy carrying `noTools: true`

#### Scenario: Symlink alias keys to the same entry
- **WHEN** a policy is registered through a symlink path `/alias/secrets` that resolves to `/real/secrets`, and a spawn lands in `/real/secrets`
- **THEN** `resolveCwdPolicy` SHALL apply that policy to the spawn (canonical keying — a lexical `path.resolve` would miss it)

#### Scenario: Policy for a not-yet-created dir under a symlinked ancestor still matches
- **WHEN** `/work-link` is a symlink to `/real/work`, a policy is registered for the not-yet-existing `/work-link/new`, and later that dir is created and a spawn lands in `/work-link/new`
- **THEN** `resolveCwdPolicy` SHALL apply the policy (register and resolve both canonicalize the longest existing ancestor, so the keys share a prefix)

#### Scenario: Symlink swap does not fail open
- **WHEN** a policy is registered for `/projects/target` and that path is later replaced by a symlink pointing elsewhere
- **THEN** `resolveCwdPolicy` SHALL still apply the policy to a spawn under `/projects/target` (matching on the lexical form as well as the canonical form — a tightening floor over-applies rather than disappears)

#### Scenario: Untrusted plugin cannot register
- **WHEN** an untrusted plugin (priority above the `spawnSession` trust gate) calls `ctx.registerCwdPolicy`
- **THEN** no policy SHALL be registered and a later spawn in that cwd SHALL be unaffected

#### Scenario: Plugin-supplied extension fields are rejected
- **WHEN** a trusted plugin calls `registerCwdPolicy("/w/secrets", { noTools: true, extensions: ["/evil.js"] })`
- **THEN** the call SHALL surface an observable error and register NOTHING
- **AND** a later spawn in `/w/secrets` SHALL carry neither `--no-tools` nor `-e /evil.js` from that rejected registration

#### Scenario: Overly-broad registration target is rejected
- **WHEN** a trusted plugin calls `registerCwdPolicy("/", { noTools: true })` or `registerCwdPolicy("<user-home>", { noTools: true })`
- **THEN** the call SHALL be rejected and register nothing (targets are bounded to recognized workspace roots to cap denial-of-capability blast radius)

### Requirement: Registered policies are immutable after registration

`registerCwdPolicy` SHALL store a deep-frozen copy of the policy so that mutating the object (or its `tools`/`skills`/array fields) after the call SHALL NOT change any subsequently resolved policy or spawned session.

#### Scenario: Post-register mutation has no effect
- **WHEN** a plugin registers `{ tools: ["read"] }`, then pushes `"exec"` onto the same array it passed
- **THEN** `resolveCwdPolicy` SHALL still return `tools: ["read"]` — the later mutation SHALL NOT reach any spawn

### Requirement: `unregisterCwdPolicy` is idempotent and owner-scoped

`unregisterCwdPolicy(cwd)` SHALL remove ONLY the calling plugin's entry for the resolved cwd, SHALL NOT remove any other plugin's entry for the same cwd, and SHALL be a no-op (no throw, no error) when the calling plugin has no entry registered for that cwd.

#### Scenario: Unregister removes only the caller's entry
- **WHEN** plugin A registered `{ noTools: true }` and plugin B registered `{ noBuiltinTools: true }` for `/w/secrets`, and plugin B calls `unregisterCwdPolicy("/w/secrets")`
- **THEN** `resolveCwdPolicy("/w/secrets")` SHALL still carry `noTools: true` from plugin A's surviving entry

#### Scenario: Unregister an unregistered cwd
- **WHEN** a plugin calls `unregisterCwdPolicy("/never/registered")` with nothing of its own registered there
- **THEN** the call SHALL return without throwing and leave the registry unchanged

### Requirement: A plugin's policies are dropped when it unloads

When a plugin is unloaded or disabled, the host SHALL remove ALL registry entries owned by that plugin, so a stale policy cannot constrain (nor inject into) unrelated future sessions.

#### Scenario: Unload clears the plugin's policies
- **WHEN** a trusted plugin registers `{ noTools: true }` for `/w/secrets` and is then unloaded
- **THEN** a later generic spawn in `/w/secrets` SHALL NOT carry `--no-tools` from the departed plugin's registration

### Requirement: The spawn funnel applies cwd policy to ANY spawn

`spawnPiSession(cwd, options)` SHALL resolve the cwd policy for its `cwd` and merge it into `options` (via `mergeCwdPolicy`) BEFORE building argv or env, for EVERY spawn regardless of origin — including generic (non-plugin) spawns routed through `session-api` and plugin spawns routed through the `spawnSession` hook. When `resolveCwdPolicy(cwd)` returns no policy, the produced argv and env SHALL be byte-identical to the output produced before this capability existed.

#### Scenario: Policy applied to a generic (non-plugin) spawn
- **WHEN** `registerCwdPolicy("/w/secrets", { noTools: true })` is registered and a generic user-initiated spawn lands in `/w/secrets` with no caller `scope`
- **THEN** the spawned pi argv SHALL contain `--no-tools`
- **AND** the session SHALL have been constrained without any plugin originating the spawn

#### Scenario: No matching policy is byte-identical
- **WHEN** a spawn lands in a cwd with no registered policy
- **THEN** the produced argv and env SHALL be byte-identical to the pre-change `spawnPiSession` output for that mechanism

#### Scenario: Policy tools allowlist reaches argv
- **WHEN** a policy `{ tools: ["read","grep"] }` is registered for the spawn cwd and the caller supplies no `scope`
- **THEN** the argv SHALL contain `--tools` followed by `read,grep`

### Requirement: Host policy composes non-weakeningly with a caller's scope

`mergeCwdPolicy(policy, options)` SHALL be a pure function that composes host policy with the caller's own capability fields such that the caller's tool/skill surface can only be TIGHTENED, never widened, by host policy. Composition SHALL be: `tools` and `skills` allowlists → INTERSECTION; `excludeTools` → UNION; `noBuiltinTools` / `noTools` / `noSkills` → logical OR (sticky-true). It SHALL NOT compose `extensions` or `extensionConfig` (those are widenings / order-dependent and belong to the deferred ops-config path). For an allowlist field, an ABSENT side SHALL mean “no constraint from that side”: when the policy supplies an allowlist and the caller omits it, the merged result SHALL be the policy's allowlist (the host restriction takes effect — it SHALL NOT be treated as “caller unrestricted”); when the caller supplies one and the policy omits it, the caller's list SHALL pass through unchanged. Every composition operator SHALL be commutative and associative so composing 3+ ancestor policies is order-independent. An absent or empty policy SHALL return `options` unchanged.

#### Scenario: Allowlist intersection tightens the caller
- **WHEN** the caller scope has `tools: ["read","grep","write"]` and the policy has `tools: ["read","grep"]`
- **THEN** the merged `--tools` SHALL be `read,grep` (intersection) and SHALL NOT contain `write`

#### Scenario: Caller cannot widen a host ban
- **WHEN** the policy has `noTools: true` and the caller scope has `noTools: false` (or omits it) and `tools: ["read"]`
- **THEN** the merged options SHALL still carry `noTools: true` — the caller SHALL NOT clear the host ban

#### Scenario: Denylist union
- **WHEN** the caller scope has `excludeTools: ["write"]` and the policy has `excludeTools: ["exec"]`
- **THEN** the merged `--exclude-tools` SHALL contain both `write` and `exec`

#### Scenario: Sticky-true booleans
- **WHEN** either the policy or the caller sets `noBuiltinTools: true`
- **THEN** the merged options SHALL carry `noBuiltinTools: true`

#### Scenario: Policy allowlist applies when the caller omits tools
- **WHEN** the policy has `tools: ["read"]` and the caller options omit `tools` entirely
- **THEN** the merged `--tools` SHALL be `read` (the host restriction takes effect; the absent caller side SHALL NOT be treated as “unrestricted”)

#### Scenario: Composition is order-independent across 3+ ancestors
- **WHEN** three ancestor policies `{noTools:true}`, `{excludeTools:["a"]}`, `{excludeTools:["b"]}` are composed in any order
- **THEN** the resolved policy SHALL be identical regardless of composition order (`noTools:true`, `excludeTools` ⊇ {a,b})

#### Scenario: Empty policy is identity
- **WHEN** `mergeCwdPolicy({}, options)` is called
- **THEN** the returned options SHALL equal `options` (no field added or changed)

### Requirement: Nested and same-path registrations compose, never overwrite

`resolveCwdPolicy` SHALL compose EVERY registered entry that is an ancestor of (or equal to) the spawn cwd — across all owning plugins AND all matching ancestor directories — via `mergeCwdPolicy`. A second registration at the SAME resolved path SHALL compose with the existing one, never replace it, so no registration can weaken a floor another established. Prefix matching SHALL occur at path-segment boundaries so a sibling like `/work-shop` does not match a registration at `/work`.

#### Scenario: Broad ban survives a narrow looser registration
- **WHEN** `/work` is registered with `{ noTools: true }` and `/work/secrets` with `{ tools: ["read"] }`, and a spawn lands in `/work/secrets/deep`
- **THEN** the merged policy SHALL carry `noTools: true` (from `/work`) — the narrower `/work/secrets` registration SHALL NOT re-enable tools

#### Scenario: Same-path second registration composes, not replaces
- **WHEN** `{ excludeTools: ["exec"] }` is registered for `/w/secrets`, then `{ excludeTools: ["write"] }` is registered for `/w/secrets`
- **THEN** `resolveCwdPolicy("/w/secrets")` SHALL exclude BOTH `exec` and `write` (union), not just the later one

#### Scenario: Sibling prefix does not false-match
- **WHEN** `/work` is registered and a spawn lands in `/work-shop/app`
- **THEN** `resolveCwdPolicy` SHALL NOT apply the `/work` policy to that spawn

### Requirement: No shipping path injects extensions or widens a caller

In this change there SHALL be no entry point that causes host policy to ADD an `extensions` / `extensionConfig` a caller did not already carry. The plugin-facing path rejects such fields (above) and `mergeCwdPolicy` does not compose them, so a resolved policy SHALL never widen a spawn's executable surface. Extension injection is deferred to the ops-config source, which will govern it as an explicit trusted-operator widening outside the caller-non-weakening rule.

#### Scenario: No plugin path produces an extension-bearing policy
- **WHEN** the only registrations came through the plugin-facing `registerCwdPolicy`
- **THEN** no resolved policy SHALL carry `extensions` / `extensionConfig`, and no spawn SHALL gain a `-e` flag or `PI_EXT_*` var from host policy
