# local-proof-refusal-log.ts — index

`createLocalProofRefusalLogger` — one bounded line `[local-proof] refused peer=… host=<sanitized> method=… route=<pattern>` per (route pattern, reason) per 60 s; ≤256 keys then a shared `<other>` bucket; `sanitizeForLog` strips control/whitespace/non-ASCII, caps length. Fed by `setLocalProofRefusalObserver` in `localhost-guard.ts`. See change: close-container-loopback-impersonation (D6).
