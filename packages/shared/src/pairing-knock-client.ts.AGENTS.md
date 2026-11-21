# pairing-knock-client.ts — index

Native LAN-knock client: `ProveFn`, `proveExpected`, `sendKnock`, `knockServerWith`, `knockRequestBody`. See change: add-electron-server-windows (D2). Approved outcome carries validated `routes?`; `redeemPairingCode` posts `/api/pair/redeem` + polls. See change: group-servers-by-identity.

`KnockHooks.deviceKey?: DeviceKeyProvider` (`{sign(fp, nonce), prove?, challenge?}`): `sendKnock`/`redeemPairingCode` add `deviceKey {deviceNonce,pub,sig}` bound to the proving challenge (re-challenged via `provider.prove` when older than `DEVICE_NONCE_REUSE_MS`; a re-challenge proving another fingerprint ⇒ `identity_mismatch`, any other failure ⇒ no key). `knockServerWith` hands the proving challenge to the provider. `ProveFn` result may carry `deviceNonce`; `proveExpected` returns it. No provider/nonce/key ⇒ body unchanged. See change: device-key-mutual-check.
