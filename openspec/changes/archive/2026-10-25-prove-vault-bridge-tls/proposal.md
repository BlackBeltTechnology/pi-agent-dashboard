## Why

The vault delivers only to hub-local sessions. Its trust gate admits a paired device only over TLS, but the hub cannot verify TLS for a bridge connection, so `isTls` defaults to false and every remote session is refused as `transport-insecure` (`packages/server/src/vault/vault-delivery-hub.ts:10-13,211`). The gateway listener is plain `ws`, and TLS terminates at a proxy. This blocks remote env delivery, remote lease and proxy delivery (`add-vault-llm-delivery`), and the paired-device half of `add-vault-reach-all-projects`.

## What Changes

- **Bridges over the native TLS listener (opt-in).** A new `tls.acceptBridges` switch lets the Built-in HTTPS listener route `/ws/bridge` upgrades into the pi gateway, under ticket-only bridge auth. A ticket-admitted connection there is always attributed to its device. Off by default.
- **Hub-observed proof.** A paired device is trusted for remote delivery only when all of these hold:
  - its upgrade arrived on the hub's own TLS socket with no forwarding header;
  - its ticket was minted the same way;
  - the device is active;
  - its bearer was never presented or issued off a proven channel;
  - its bridge declares certificate validation enforced.

  This replaces the never-wired `isTls(sessionId)` predicate. Proxy-asserted headers are not evidence.
- **Hub-local needs local admission.** Hub vault delivery requires the unix socket, a local credential proof, or the in-process connection. Loopback by address alone no longer qualifies (legacy token, tokenless grace, deviceless or device ticket), because an L4 forwarder looks the same. This tightens deprecated paths, which now report `local-unproven`.
- **Bearer exposure record.** The paired-device registry records the first use or issue of a bearer outside a proven channel. A proven channel is proven TLS, or a valid local credential proof. Devices paired before this change have unknown history and need a new token.
- **TLS-only bridge tokens.** An operator token issued for a bridge on another machine is available only over a proven channel, and carries a `pi_tls_` prefix. The bridge never sends it to a non-`https` origin, so an active MITM never sees it. The hub refuses it (and records exposure) on any non-proven channel. MCP and QR tokens are unchanged.
- **Deactivation withdraws.** Revoking or holding a device, recording its bearer as exposed, or turning Accept bridges off pushes `denied` to the affected connected sessions within 5 s. Expiry does the same within 60 s.
- **Bridge validates the certificate.** For TLS endpoints, the bridge refuses to dial or send its bearer when TLS validation is disabled (`tls-verify-disabled`). A `wss://` endpoint without a path dials `/ws/bridge`.
- **Explain the refusal.** The session view, the token-issue dialog and the log name the missing proof and the fix. The causes are `unattributed`, `local-unproven`, `device-inactive`, `plain-transport`, `bearer-exposed`, `history-unknown`, `ticket-plain` and `bridge-outdated`.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `pi-gateway-auth`: remote bridges may connect over the TLS listener, and remote endpoints require certificate validation.
- `bearer-device-auth`: plaintext bearer exposure is recorded, and tokens issued on a proven channel are TLS-only.
- `dashboard-tls-listener`: the listener serves the bridge path behind an opt-in switch.
- `credential-delivery`: defines what "over TLS" means in "Delivery only to granted sessions on trusted devices" (proven by the hub itself). Revocation withdraws, and refused sessions explain the cause.

## Impact

- **Server:** gateway listener / pairing transport; vault delivery hub trust gate.
- **Bridge:** the connection setup for paired devices.
- **Security:** the vault's remote delivery depends entirely on this proof. `doubt-driven-review` is mandatory before design.
- **Order:** prerequisite for remote delivery in `add-vault-llm-delivery` and `add-vault-reach-all-projects`. Neither blocks on it for hub sessions.

## Discipline Skills

- `security-hardening`: transport confidentiality, device binding.
- `doubt-driven-review`: before choosing the proof mechanism (irreversible trust decision).
- `observability-instrumentation`: why a remote session is refused.
