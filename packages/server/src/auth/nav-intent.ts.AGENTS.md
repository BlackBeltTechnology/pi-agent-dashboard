# nav-intent.ts — index

`NavIntents` — per-process-key HMAC navigation intents: `mint(principal, kind, target)` → `b64url(e).b64url(mac)` (600 s), `verify(ni, principal, kind, target)` (constant-time). `canonicalNavTarget`, `isNavIntentKind`. See change: harden-client-sinks.
