# server-keyring.ts — index

`ServerKeyring` / `loadKeyring`: paired servers by fingerprint in `~/.pi-dashboard/server-keyring.json` (v1). Bearer only via `safeStorage` (`CryptoPort`); no encryption or Linux `basic_text` ⇒ memory only, `remembered:false`. Atomic `wx` 0600 temp + fsync + rename; POSIX load tightens mode. Corrupt/unknown version ⇒ `server-keyring.corrupt-<ts>.json`, empty, one log. Undecryptable bearer ⇒ `needsPairing`. `lastHosts` MRU 5, http never precedes https. `list()` renderer-safe (no bearer). See change: add-electron-server-windows (D4).

## group-servers-by-identity

`lastHosts[].source` (saved|mdns|pairing); `addDeliveredHosts` (<=3, then 5-host cap). See change: group-servers-by-identity.

## device-key-mutual-check

Entry gains `deviceKey: DeviceKey | null` (main-process only; `deviceKeyFor(fp)`). Disk: `deviceKey {pub, priv {enc:"safeStorage", data}}`; `pub` clear, private PKCS#8 encrypted. No encryption ⇒ key memory-only, not written. Undecryptable / unparseable / pub-mismatch key ⇒ dropped alone (log `device key undecryptable`), credential kept ⇒ row "key-pending". `savePaired({deviceKey?})` never inherits an older key; `markNeedsPairing` drops key with bearer. `KeyringEntryView` = no bearer, no key object, `keyHeld: boolean`. Old loader drops `deviceKey` on save (field-by-field) ⇒ current build reads key-pending. See change: device-key-mutual-check.
`setDeviceKey(fp,key)`: stores a bound key for an entry with a credential and no key (key-pending bind, 200 only); refuses unknown / needs-pairing / already-keyed. See change: device-key-mutual-check.
