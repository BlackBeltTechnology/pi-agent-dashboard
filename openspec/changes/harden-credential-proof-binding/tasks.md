## 1. Immutable verdict stamp

- [x] 1.1 Test (L1) in `packages/server/src/__tests__/local-credential.test.ts` (extend): stamp a request, then `Object.defineProperty` the Symbol with a `proof` verdict and plain assignment. Observable: both throw/are ignored and `credentialVerdict(headers).kind` is still the original. Verify red before 1.2.
- [x] 1.2 `auth/local-credential.ts`: define the stamp `writable: false, configurable: false`. Verify: 1.1 green and the existing `local-credential*.test.ts` stay green.

## 2. Floor after readiness

- [x] 2.1 Test (L1) in `local-credential.test.ts`: `listenWithProofFloor` with a fake app whose `ready()` resolves after a delay and a recording `listen`. Observable: call order `ready → floor → listen`; the floor is later than ready's resolution; a failing `ready` never sets the floor or listens.
- [x] 2.2 Add `listenWithProofFloor(app, setFloor, listenOpts, now?)` to `auth/local-credential.ts`; use it at the `fastify.listen` call in `server.ts` (replacing `httpBoundAt = Date.now(); await fastify.listen(...)`). Verify: 2.1 green.

## 3. IP-literal dial host

- [x] 3.1 Test (L1) in `packages/shared/src/__tests__/local-credential-proof.test.ts` (extend): `localDialHost("myhost.example")` is `127.0.0.1`; `canonicalBinding(localDialHost(name), port)` does not throw; `httpProofHeaders` for a name bind host mints a verifying proof. Verify red before 3.2.
- [x] 3.2 `shared/src/local-credential-proof.ts`: a non-IP host maps to `127.0.0.1`. Verify: 3.1 green and the existing `localDialHost` table (E20) stays green.

## 4. Spawn endpoint from the gateway's real TCP host

- [x] 4.1 Test (L1) in `packages/server/src/__tests__/gateway-transport-policy.test.ts` (extend): `spawnDialHost(policy)` for {socket only → `127.0.0.1`; tcp `0.0.0.0` → `0.0.0.0`; fallback pinned `127.0.0.1` → `127.0.0.1`; tcp `::1` → `::1`; tcp `192.168.1.5` → `192.168.1.5`; tcp `localhost` → `null`}. Verify red before 4.2.
- [x] 4.2 Add `spawnDialHost` to `pi/gateway-transport-policy.ts`; in `server.ts` call `setSpawnDashboardPiPort(config.piPort, spawnDialHost(policy))` once the listener policy is known (the earlier call passes no host). Verify: 4.1 green and the `process-manager-spawn-env.test.ts` E19 table stays green.

## 5. Integration

- [ ] 5.1 Full suite `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` shows no failure attributable to this change.
- [ ] 5.2 `review-code` on the diff; fix findings. Docs: no prose change needed (behaviour matches `docs/architecture.md` "Local credential proof"); update the touched files' AGENTS.md rows (`See change: harden-credential-proof-binding`).
