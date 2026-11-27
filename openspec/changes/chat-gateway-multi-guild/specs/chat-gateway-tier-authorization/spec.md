## MODIFIED Requirements

### Requirement: Tier resolution from chat identity
Every action-bearing message or interaction SHALL resolve to exactly one tier (`observe`, `control`, `operate`) or to a refusal. Resolution SHALL consider the author's platform identifier first and mapped platform roles second; when both apply, the highest resulting tier wins. Principal entries and role mappings SHALL be scoped to a single binding — a principal mapped for one binding SHALL NOT thereby gain any tier in another. A request with no binding in an enabled server, and every server-scoped verb (A: disarm), SHALL resolve against that server's own `principals` and `roles`. Server mappings SHALL NOT grant any other tier inside a binding. Disarm in a bound channel SHALL take the higher of the binding and server tier.

#### Scenario: Unlisted user
- **WHEN** an allowlisted user with no matching identifier entry and no mapped role sends an action-bearing message in a bound channel
- **THEN** the request resolves to a refusal and no action is taken

#### Scenario: Identifier and role both grant
- **WHEN** a user is listed at `observe` by identifier and holds a role mapped to `control` on the same binding
- **THEN** the effective tier is `control`

#### Scenario: Principal mapped for a different binding
- **WHEN** a principal mapped at `control` for one binding acts in a different bound channel where they are not mapped
- **THEN** the request resolves to a refusal

#### Scenario: Server mapping grants no binding tier
- **WHEN** a user mapped at `control` on server A's record, but not on a binding in server A, acts in that binding's channel
- **THEN** the request resolves to a refusal

#### Scenario: Server observer disarms inside a binding
- **WHEN** a user mapped at `observe` on server A's record, and not on the binding, issues the disarm command in a bound channel of server A
- **THEN** server A is disarmed

#### Scenario: Server mapping does not cross servers
- **WHEN** a user mapped at `observe` on server A's record makes a server-scoped request in server B
- **THEN** the request resolves to a refusal

### Requirement: Operator-configurable ceiling
The layer SHALL enforce a configured maximum tier. A resolved tier above the ceiling SHALL be clamped to it. The ceiling SHALL default to `observe`. A server record's `ceiling` SHALL only lower the global ceiling for every request in that server, binding-scoped or server-scoped. An absent server ceiling SHALL apply the global ceiling.

#### Scenario: Ceiling clamps a grant
- **WHEN** the ceiling is `control` and a principal is configured at `operate`
- **THEN** that principal's effective tier is `control`

#### Scenario: Default ceiling on a fresh install
- **WHEN** the layer is enabled with no ceiling configured
- **THEN** the effective ceiling is `observe`

#### Scenario: Server ceiling cannot raise the global ceiling
- **WHEN** the global ceiling is `control` and a server record sets `operate`
- **THEN** requests in that server are clamped to `control`

#### Scenario: Server ceiling lowers a binding
- **WHEN** a binding allows `control` and its server's ceiling is `observe`
- **THEN** a `control` principal on that binding resolves to `observe`

### Requirement: Disarm switch
Any principal holding at least `observe` SHALL be able to disarm the server the command came from, in both `interactive` and `query` mode (an emergency brake). While a server is disarmed, output SHALL continue to be mirrored but every action-bearing request in it from every principal SHALL be refused. The dashboard SHALL offer disarm-all and SHALL be the only way to re-arm one server or all servers.

#### Scenario: Observer disarms during a bad run
- **WHEN** an `observe` principal issues the disarm command in a server
- **THEN** subsequent prompts, aborts, and commands from all principals in that server are refused
- **AND** the disarmed state of that server is visible on the dashboard configuration surface

#### Scenario: Observer disarms a query server
- **WHEN** an `observe` principal of an enabled `query` server issues the disarm command there
- **THEN** that server is disarmed and is not refused with `query_mode`

#### Scenario: Re-arming requires the dashboard
- **WHEN** a `control` principal attempts to re-arm from chat
- **THEN** the layer refuses and the disarmed state persists

#### Scenario: Mirroring survives disarm
- **WHEN** a server is disarmed and a bound session in it produces output
- **THEN** that output continues to appear in its thread

#### Scenario: Disarm in one server leaves others running
- **WHEN** a principal disarms server A from chat
- **THEN** requests in server B are still authorized as before

#### Scenario: Dashboard disarm-all and re-arm
- **WHEN** the operator disarms all servers from the dashboard and then tries to re-arm one server
- **THEN** the re-arm is refused with `global_disarm_active` and requests everywhere stay refused until the operator re-arms all

#### Scenario: Re-arm one server
- **WHEN** the operator re-arms server A from the dashboard while server B is also disarmed
- **THEN** requests in A are authorized again and requests in B are still refused

