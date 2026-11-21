# pairing-client.ts — index

`startPairing(target, deps)` → `PairingSession{send,stop,done}`. Phases proving → confirm → waiting → approved \| rejected \| expired \| refused \| mismatch \| unverifiable \| unreachable \| stopped. Identity proven BEFORE knock (pin ?? advert; none ⇒ TOFU confirm w/ full fp). Request sent only after user `send(name)`. Bearer + pin saved to keyring ONLY on approval. Logs short fp + host only; never bearer/code/name. Ports injected; no electron import. See change: add-electron-server-windows (D3, D11).

## group-servers-by-identity

Approval stores delivered routes before `done`; `PairingTarget.source`. See change: group-servers-by-identity.

## harden-peer-address-identity

`PairingTarget.alternatives` (≤ 8 literals); deps `lookup`, `localFp`. Primary + alternatives (http names resolved) are proven in order: `ok` binds the literal (knock, poll, saved host), `self` skips (logged), `foreign` ⇒ mismatch, none ⇒ `unreachable` (a self seen) / `unverifiable`. See change: harden-peer-address-identity.

## device-key-mutual-check

Knock carries `deviceKey {deviceNonce,pub,sig}` via shared `DeviceKeyProvider`: proving challenge nonce reused <= 30 s, re-run at the bound literal after. Key generated in memory (`deps.generateKey`) only when a nonce exists; `savePaired({deviceKey})` on approval only; reject / expiry / stop / quit leave nothing on disk. Same in `pairing-code-client.ts` (redeem body). See change: device-key-mutual-check.
