# server-windows.ts — index

`createServerWindows(deps)`: one window per paired server on its own origin. open → pick host (prove pinned fp) → `session.fetch` `/api/device-session` in the server's partition (`redirect:manual`) → load origin. Sandbox, no preload, same-origin nav only (`will-navigate`/`will-redirect`), `setWindowOpenHandler` deny, permission allowlist. 401/403 only triggers rate-limited (5 min) exchange re-run; refused ⇒ needs pairing + one dialog. Re-verify identity 60 s / focus / resume; mismatch ⇒ `about:blank` + cookie removed. Forget. Pure helpers `classifyExchange`, `composeTitle`, `parseManualUrl`. Electron via injected ports. See change: add-electron-server-windows (D5–D8, D12, D14).
`dom-ready` on own origin ⇒ `executeJavaScript` plants non-secret `pi-dashboard:device-paired` marker so remote client mints WS ticket (bearer never enters page).

## group-servers-by-identity

`pairWithCode`, `submitCode`, `source` on targets. See change: group-servers-by-identity.

## harden-peer-address-identity

Proof bound to an address literal: `http` hostnames resolve (injected `lookup`, ≤ 8 literals/name, 2 s) to literals, each proven separately; exchange, origin, heal, re-verify use the proving literal. `probe` → `ok|self|foreign|unverified|unreachable` via shared `classifyProof` + `discovery.localFp()`. `pickHost` returns proving literal + `foreign[]`; candidates: stored, then discovered ordered by `orderByLocality` (own last), batches of 12. Window state `live|parked|blanked`; `reselect(ow, proof)` is the ONE transition behind `reverify` and `recheck`: transport failure keeps page + reruns `pickHost`; self/foreign ⇒ `about:blank`, `clearStorageData({storages:["cookies"]})` awaited (fail ⇒ stay parked, retry next trigger), then `pickHost` ⇒ `replaceWindow` (`host moved`) | foreign seen ⇒ `blanked` + one notice | else parked "not reachable". `focusExisting` replaces non-`live`. `pairAgain`/`connectDiscovered` pass `alternatives`. Logs `candidate skipped … reason=self`, `foreign proof …`, `host moved …` (no secrets). See change: harden-peer-address-identity.
