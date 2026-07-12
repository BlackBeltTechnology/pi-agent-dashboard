# packages/shell

Neutral static PWA shell. Published to GitHub Pages (pi-dashboard.dev). NOT served by any dashboard server. Holds IndexedDB keyring of paired servers. Boots with zero server dependency. See change: add-server-keypair-pairing.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This per-directory file index. |
| `package.json` | Private pkg `@blackbelt-technology/pi-dashboard-shell`. Deps react, react-dom, wouter. Dev deps vite, @vitejs/plugin-react, @tailwindcss/vite, tailwindcss, fake-indexeddb. Scripts dev/build/preview. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. jsx react-jsx, noEmit, DOM libs. include `src`. |
| `vite.config.ts` | base `./` for GitHub Pages subpath. react + tailwind plugins. root `src`, outDir `../dist`. `spa404Fallback` plugin copies index.html → 404.html post-build. |
| `vitest.config.ts` | jsdom env, include `src/**/*.test.{ts,tsx}`. Registered in root `vitest.config.ts` `test.projects` so `npm test` covers the shell. |
| `src/App.tsx` | Root component. Hash-routed tabs: `/` KeyringView, `/pair` PairView. `refreshKey` bumps keyring reload after pairing. |
| `src/main.tsx` | Entry. Mounts App in `Router hook={useHashLocation}` + StrictMode. Imports index.css. |
| `src/index.html` | HTML shell. `<meta http-equiv=CSP>` connect-src self https: wss: (talks to arbitrary paired servers). `class="dark"`. |
| `src/index.css` | `@import "tailwindcss"`. Dark theme base. |
| `src/lib/protocol.ts` | Wire helpers. base64url encode/decode, `decodePayloadString` (tolerates a `https://…/pair#<payload>` scannable-QR wrapper → takes URL fragment; strips `pi:pair:v1.` prefix; also bare b64 / raw JSON — so ONE QR serves phone camera + Electron scan/paste), `postJson`/`getJson` envelope unwrap, `challengeIdentity` (WebCrypto Ed25519 verify of signed nonce). Types `ApiResponse`, `PairingPayload`, `IdentityProof`. See change: make-pairing-qr-camera-scannable. |
| `src/lib/keyring.ts` | IndexedDB store `pi-dashboard-shell/servers`, keyPath `id`. Entry `{id,label,urls,pinnedPubkey,pinnedFingerprint,bearerToken}`. `addServer`/`listServers`/`removeServer`. In-memory Map fallback when no indexedDB. |
| `src/lib/keyring.test.ts` | vitest over keyring. Uses `fake-indexeddb/auto`. Covers add/list, upsert, remove, reload-survival. |
| `src/lib/connect.ts` | `connectServer(entry)`. Races `urls[]`, verifies signed nonce vs pinned pubkey+fingerprint, REFUSES impostor. Bearer → GET /api/paired-devices. Fresh /api/ws-ticket per connect. Opens wss `/ws?ticket=`. Bearer never in WS URL. Returns `ConnectLog`. |
| `src/components/PairView.tsx` | Pairing UI. Paste box + BarcodeDetector QR scan. Verify fingerprint → redeem code → show 8-digit confirmCode → poll ~2s until approved → store keyring entry. Handles pin-mismatch, expired code. |
| `src/components/KeyringView.tsx` | Lists paired servers. Per-row Connect (runs connectServer, shows log lines + identity-mismatch warning) + Remove. |
