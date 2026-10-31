# remote-credentials.ts — index

`stripRemoteCredentials(raw)`: http(s) ⇒ drop all userinfo; other `scheme://user:pass@host` ⇒ drop password, keep user; scp/no-userinfo ⇒ unchanged; userinfo + no usable host ⇒ `undefined`. Keeps raw shape (never `normalizeOrigin`'s host/path). `remoteForWire(raw)` = strip + drop `?query`/`#fragment` of a URL form (vault sync origin + hub receipt); git-link-builder uses the strip. See change: harden-bridge-inbound-and-discovery (D18).
