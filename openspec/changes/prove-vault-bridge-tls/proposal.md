## Why

The vault delivers only to hub-local sessions. Its trust gate admits a paired device only over TLS, but the hub cannot verify TLS for a bridge connection, so `isTls` defaults to false and every remote session is refused as `transport-insecure` (`packages/server/src/vault/vault-delivery-hub.ts:10-13,211`). The gateway listener is plain `ws`, and TLS terminates at a proxy. This blocks remote env delivery, remote lease and proxy delivery (`add-vault-llm-delivery`), and the paired-device half of `add-vault-reach-all-projects`.

## What Changes

- Define how the hub proves that a paired device's bridge connection is confidential end to end. Candidates for the design: a TLS-terminating hub listener; a proxy-asserted header bound to the device credential; or payload encryption to the device's pairing key, which makes transport TLS unnecessary for vault material.
- Wire the proof into `isTls(sessionId)` (or replace the predicate) in the vault delivery hub.
- Show the remote state in the session view: why a paired device does or does not receive vault values.

## Capabilities

### New Capabilities
- (to be decided in design)

### Modified Capabilities
- `credential-delivery`: "Delivery only to granted sessions on trusted devices" — how TLS is established.

## Impact

- **Server:** gateway listener / pairing transport; vault delivery hub trust gate.
- **Bridge:** the connection setup for paired devices.
- **Security:** the vault's remote delivery depends entirely on this proof. `doubt-driven-review` is mandatory before design.
- **Order:** prerequisite for remote delivery in `add-vault-llm-delivery` and `add-vault-reach-all-projects`. Neither blocks on it for hub sessions.

## Discipline Skills

- `security-hardening`: transport confidentiality, device binding.
- `doubt-driven-review`: before choosing the proof mechanism (irreversible trust decision).
- `observability-instrumentation`: why a remote session is refused.
