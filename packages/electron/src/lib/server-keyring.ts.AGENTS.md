# server-keyring.ts — index

`ServerKeyring` / `loadKeyring`: paired servers by fingerprint in `~/.pi-dashboard/server-keyring.json` (v1). Bearer only via `safeStorage` (`CryptoPort`); no encryption or Linux `basic_text` ⇒ memory only, `remembered:false`. Atomic `wx` 0600 temp + fsync + rename; POSIX load tightens mode. Corrupt/unknown version ⇒ `server-keyring.corrupt-<ts>.json`, empty, one log. Undecryptable bearer ⇒ `needsPairing`. `lastHosts` MRU 5, http never precedes https. `list()` renderer-safe (no bearer). See change: add-electron-server-windows (D4).
