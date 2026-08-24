# iroh transport research — is it worth it for bridge / server / client comms?

**Date:** 2026-06-25
**Status:** Research / explore-mode note. No implementation.
**Verdict:** Not worth it now. [2026-08-13 revisit](#2026-08-13-revisit--ruled-out-with-evidence): ruled out with evidence — no `darwin-x64` binary, silent install-succeeds/require-fails. Superseded by [bridge-transport-and-identity](../research/bridge-transport-and-identity.md).

## Question

Is it worth adopting [iroh](https://iroh.computer/) for pi-dashboard bridge ↔ server ↔ client communication?

## Current topology (three legs)

```
┌─────────────┐   WS :9999    ┌──────────────┐   WS :8000   ┌─────────────┐
│ pi + bridge │ ────────────▶ │  Dashboard   │ ◀──────────  │   Browser   │
│ (extension) │   localhost   │   Server     │  localhost   │   (React)   │
│  Node.js    │               │  Node.js     │  or zrok     │  Chromium   │
└─────────────┘               └──────────────┘              └─────────────┘
   same host                    same host                   remote = zrok
   no NAT                       no NAT                       tunnel + OAuth
```

- **Leg A — bridge → server (WS :9999):** both ends Node.js, same machine. Reconnect/backoff/replay already solved. No NAT, no internet hop.
- **Leg B — browser → server (WS :8000):** client is a Chromium browser (or Electron renderer). Local or via tunnel.
- **Leg C — remote access:** only leg crossing NAT/internet. Today = zrok reserved share + OAuth + tunnel-watchdog + trusted-networks + JWT.

## What iroh is

Rust library for direct peer-to-peer QUIC connections with NAT holepunching, relay fallback, TLS 1.3, dial-by-public-key. Every endpoint speaks QUIC over UDP by default.

JS support = `@number0/iroh` **NAPI native bindings, Node.js only** (per-platform prebuilt binaries, Node ≥ 20.3). Browser/WASM support is partial and still routes over **relay WebSockets** — no holepunching inside a browser tab.

## Mapping iroh onto each leg

| Leg | Problem iroh solves? | Verdict |
|---|---|---|
| **A** bridge↔server | Same-host localhost. No NAT, no transport pain. | ❌ Zero value. Pure overhead. |
| **B** browser↔server | Client is Chromium. Native iroh can't run in a browser; WASM falls back to relay+WS anyway. | ❌ Can't even apply it. |
| **C** remote access | NAT traversal — iroh's home turf. But the consumer is a browser, which still can't dial iroh natively. | ⚠️ Only if a native client existed. |

## Core blocker

iroh wins when **both peers run native code** behind NATs. pi-dashboard's remote leg always terminates in a **web browser** — exactly what iroh's native QUIC stack can't run in. The one place P2P matters (Leg C) is the one place you can't use the good part of iroh. You'd be stuck on iroh's relay-over-WebSocket path — what zrok already gives, minus the mature reserved-URL / OAuth / trusted-network / watchdog layer already built.

## Narrow future niche (the only one)

```
  Electron desktop (native Node main)  ──iroh QUIC──▶  remote Docker server (Node)
              │                                                  │
              └── renderer talks WS to its OWN localhost main ───┘
```

If the **Electron main process** (native Node) became a local proxy that dials the remote server over iroh, and the renderer kept talking plain WebSocket to `localhost` inside Electron, then iroh replaces zrok for desktop-app remote mode: no public URL, no tunnel daemon, dial-by-key auth.

Caveats:
- Helps only the Electron remote path, not browser-from-phone.
- Parallel transport, not a replacement — zrok still needed for "open dashboard in any browser."
- Adds a native Rust dependency + per-platform binaries to an Electron build already fighting bundling / immutable-bundle complexity.

## Recommendation

- **Now:** do not adopt. Two of three legs are localhost Node↔Node (no transport problem); remote leg dead-ends in a browser.
- **Revisit if:** Electron remote mode becomes a priority and killing the public-tunnel dependency is desired → spike "iroh in Electron main as localhost↔remote QUIC proxy."

## Sources

- https://iroh.computer/ , https://github.com/n0-computer/iroh
- https://docs.iroh.computer/languages/javascript (`@number0/iroh` NAPI bindings)
- https://docs.iroh.computer/concepts/nat-traversal , .../concepts/relays
- https://kerkour.com/iroh-v1-p2p (deep dive: building block, bring your own protocol)

## 2026-08-13 revisit — ruled out with evidence

Original verdict not wrong, incomplete. iroh reached **1.0 stable 2026-06-15** — five days before the original note — and was never accounted for. Current `@number0/iroh` = **1.1.0** (published 2026-07-16). 17 versions total; first `0.22.1-test4` 2024-08-14. Revisit ran inside the bridge-transport research ([`docs/research/bridge-transport-and-identity.md`](../research/bridge-transport-and-identity.md), openspec change `add-pi-gateway-transport-identity`).

### Package facts (verified)

- **Typed TS API, Rust NAPI implementation** — not a TS/WASM port. Ships `types: iroh-js/index.d.ts`, `typedoc.json`, `Cargo.toml`, `build.rs`, `src/`. `engines: node >= 20.3.0`.
- **No WASM / browser package exists.** Probed, all 404: `iroh-js`, `iroh-wasm`, `@n0-computer/iroh`, `@n0-computer/iroh-js`, `@number0/iroh-js`, `@number0/iroh-wasm`, `@number0/iroh-browser`.
- **BLOCKER — no macOS x64 binary.** `optionalDependencies` of 1.1.0 covers 11 platforms (android-arm-eabi, android-arm64, darwin-arm64, linux-arm-gnueabihf, linux-arm-musleabihf, linux-arm64-gnu, linux-arm64-musl, linux-x64-gnu, linux-x64-musl, win32-arm64-msvc, win32-x64-msvc). `darwin-x64` absent. On npm `@number0/iroh-darwin-x64` stranded at `0.22.1-test1` (abandoned ~2024-08) while `darwin-arm64` tracks 1.1.0. Official docs table (docs.iroh.computer/languages/javascript) lists macOS **arm64 only**.
- **Failure mode silent.** Verified darwin/x64 + node v24.15.0: `npm install @number0/iroh` → "added 1 package in 1s", exit 0; `find node_modules -name '*.node'` → nothing; `require('@number0/iroh')` → `Cannot find native binding.` Install succeeds; runtime fails.
- **Packaging defect in 1.1.0:** `main` = `iroh-js/index.js`, but published tarball puts `index.js` at package root. Loads only via Node's index.js fallback.

### Why this disqualifies iroh here specifically

Bridge = pi extension loaded into **every pi session on every user machine**. Missing native binary ⇒ bridge never loads ⇒ session starts ⇒ card never appears ⇒ no error surfaced. Same silent-failure signature as the mDNS hijack the transport change was meant to escape.

### Revised verdict

**Ruled out with evidence** — not merely "not worth it". Reconsider only if n0 restores `darwin-x64` AND a native (non-browser) client exists on both ends.
