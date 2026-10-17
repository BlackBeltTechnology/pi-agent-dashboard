# plugin-operate-authority Specification

## Purpose
Let a dashboard plugin's server routes apply the same operate-authority rule the host applies to managed-service mutations, without coupling plugins to host request internals.

## Requirements

### Requirement: Operate-authority predicate on the plugin identity seam
The plugin server context's identity seam SHALL offer a read-only predicate that, given a plugin HTTP route request, answers whether the caller has operate authority. The answer SHALL equal the host's decision for `/api/services` mutations on the same request: true for an operate-tier device bearer, an authenticated operator session or principal, or a locally trusted caller (honouring strict mode); false for an unauthenticated trusted-network caller and for observe- or control-tier bearers. The predicate SHALL grant nothing by itself and SHALL be available to every plugin regardless of trust or priority.

#### Scenario: Operate-tier bearer
- **WHEN** a plugin route receives a request carrying an operate-tier device bearer
- **THEN** the predicate returns true

#### Scenario: Trusted-network caller without credentials
- **WHEN** a plugin route receives a request from a trusted-network address with no credential
- **THEN** the predicate returns false

#### Scenario: Observe-tier bearer
- **WHEN** a plugin route receives a request carrying an observe-tier device bearer
- **THEN** the predicate returns false

#### Scenario: Locally trusted caller in strict mode
- **WHEN** strict local proof is enabled and a loopback request carries no local credential proof
- **THEN** the predicate returns false

#### Scenario: Parity with managed-service mutations
- **WHEN** the same request matrix is evaluated by the predicate and by the `/api/services` mutation check
- **THEN** both give the same answer for every request
