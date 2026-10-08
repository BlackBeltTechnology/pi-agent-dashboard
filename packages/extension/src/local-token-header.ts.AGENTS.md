# local-token-header.ts — index

Bridge side of D6: `readLocalToken(env?)` (`~/.pi/dashboard/local/token`, trimmed; empty ⇒ undefined) + `localTokenHeaders(endpoint, env?)` → `X-Pi-Local-Token` ONLY on a loopback TCP dial (undefined over `ws+unix:` and never to a remote endpoint). Wired as `ConnectionManager.headers` in `bridge.ts`. See change: add-pi-gateway-transport-identity (task 5.3).
