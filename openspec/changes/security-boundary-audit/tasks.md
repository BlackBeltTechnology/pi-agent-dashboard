# Remediation Tasks

Ordered by leverage. The systemic fixes (S1–S3) each close multiple findings; standalone bugs (B*) are independent. This audit **records** these; each behavior-changing fix should land as its own reviewed OpenSpec change (see proposal — no fixes in this change).

## Tier 0 — Do first (highest blast radius, cheapest fix)

- [ ] **S1 · Universal auth guard.** Make `networkGuard` (or an auth-independent equivalent) apply to ALL surfaces, not just core routes:
  - [ ] Attach to plugin route registrars — expose `networkGuard` on `ServerPluginContext`; gate automation/flows/kb mutating+exec+file routes (closes C-🔴, C-🟠×2, C-🟡).
  - [ ] Attach to provider-auth + models-introspection routes (closes A-🟠 provider-auth).
  - [ ] Consider running the guard as an auth-independent `onRequest` so disabling OAuth never removes it.
- [ ] **S2 · Authenticate the bridge↔server WebSocket** (closes D-🔴×2, mitigates D-🟠 mDNS): mint per-server secret (already have `config.secret`), require bridge to present it on the gateway handshake, server rejects unauthenticated gateway sockets, bind gateway to `127.0.0.1`. Verify zrok does NOT tunnel the extension-gateway `piPort`.
- [ ] **S3 · Close the client XSS trio** (closes F-🔴 markdown, F-🔴 asciidoc, F-🟠 mermaid; de-risks F-🔴 localStorage bearer): add `rehype-sanitize` + scheme-allowlist `urlTransform` to MarkdownContent; DOMPurify the asciidoctor + mermaid HTML server-side; add a strict CSP (`script-src 'self'`) for the tunnel/cross-origin case.

## Tier 1 — High, standalone

- [ ] **B1 · git checkout command injection** — route through `runGitCapture(["checkout",…argv])`, branch allowlist `^[\w./-]+$` (git-operations.ts:383/387/391). 🔴
- [ ] **B2 · Electron remote-mode preload isolation** — minimal preload for the main window (drop `remoteConnect.connect`/`doctor.run`/`readServerLog`); validate `event.senderFrame` origin in every `ipcMain.handle`. 🔴
- [ ] **B3 · Electron `shell.openExternal` scheme allowlist** — http/https/mailto only, on BOTH `setWindowOpenHandler` and `will-navigate` open-external branch (main.ts:401-412). 🔴

## Tier 2 — Medium

- [ ] **B4 · REST bearer storage** — prefer httpOnly SameSite cookie for the browser REST credential; else shorten TTL + rotate (device-auth.ts). 🟠
- [ ] **B5 · Login OAuth CSRF + open redirect** — bind state nonce to signed cookie; constrain `returnUrl` same-origin relative (auth-plugin.ts:60,214). 🟠
- [ ] **B6 · Windows `shellEscape` bypass** — replace `execSync(args.map(shellEscape))` worktree/merge/PR sites with spawn argv `shell:false` (git-operations.ts). 🟠
- [ ] **B7 · Unbounded PTY spawn** — cap concurrent PTYs global+per-cwd, reap idle (terminal-manager.ts). 🟠
- [ ] **B8 · Unconstrained browse/mkdir** — constrain roots to `$HOME` + pinned dirs (routes/file-routes.ts). 🟠
- [ ] **B9 · Recovery server** — bind loopback, gate POST reinstall/retry on local-token (recovery-server.ts). 🟠
- [ ] **B10 · Electron SSRF probe** — restrict to wizard window; deny RFC1918+link-local+loopback (remote-probe.ts). 🟠
- [ ] **B11 · document-converter bind-mounts** — `:ro` inputs, confine under workspace root, reject sensitive roots (engine.ts). 🟠
- [ ] **B12 · kb source SSRF** — https-only, block private/link-local after DNS resolve, cap redirects (kb/sources.ts). 🟠
- [ ] **B13 · kb archive zip-slip** — reject `..`/absolute entries or use traversal-safe extractor (kb/sources.ts). 🟠
- [ ] **B14 · bare-loopback trust under marker-less tunnel** — require local-token for terminal/session/git rather than trusting bare loopback (localhost-guard.ts). 🟠
- [ ] **B15 · plugin_emit_event allowlist** — allowlist emittable event names (bridge.ts:915). 🟠

## Tier 3 — Low / hardening

- [ ] B16 cookie Secure flag behind TLS tunnel (auth-plugin.ts:206)
- [ ] B17 pin JWT `algorithms:["HS256"]` (auth.ts:157); 256-bit HMAC secret (auth.ts:135)
- [ ] B18 auth audit logging: pairing approve/revoke, credential writes
- [ ] B19 narrow CORS `*.share.zrok.io` to active tunnel host (cors-origin.ts)
- [ ] B20 redact absolute paths / git stderr in error bodies (git-operations.ts)
- [ ] B21 clamp `quiesceMs`; rate-limit inbound bridge bash/prompt (bridge.ts)
- [ ] B22 strip `userinfo@` from git remote URLs before link-building (vcs-info.ts)
- [ ] B23 enforce `MAX_AUDIO_MB`; add `--` before positional media paths (ffmpeg/nano-banana)
- [ ] B24 doctor.html href scheme allowlist; execFileSync in dependency-detector.ts:91

## Verify / follow-up (RESOLVED)

- [x] V1 → **CONFIRMED**: `config.json` (auth HMAC secret) NOT 0600 → see B25 below.
- [x] V2 → **RESOLVED**: bridge `piPort` NOT tunneled (separate listener on `config.host`); D-🔴 re-scoped to same-host/LAN-only. S2 still warranted, urgency lowered.
- [x] V3 → **RESOLVED**: Electron 32.3.3, sandbox default true.
- [x] V4 → **CONFIRMED**: asciidoctor secure mode doesn't strip passthrough → S3 asciidoc fix stands.
- [x] V5 → **CONFIRMED**: 20 vulns (2 crit/3 high/15 mod); `xlsx` high reachable → B26. Postinstall scripts benign (first-party).

## Added by verification

- [ ] **B25 · chmod `0600` on config.json write** (auth HMAC secret readable by other local users under default umask) — `config.ts:948`, `config-api.ts:183`. 🟠
- [ ] **B26 · `xlsx`/SheetJS high vuln** (prototype pollution + ReDoS, no npm fix) reachable via XLSX office-preview — sandbox the parse, cap input size, or pin the vendor CDN build. 🟠 Triage the other 18 transitive (build-tooling) advisories.
