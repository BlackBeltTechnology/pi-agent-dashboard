## Why

Five Medium/Low findings of the security map (`docs/security/residual-risks.md`; premises
re-verified at HEAD `109f2e197` in `/tmp/secmap/batch2/VERIFY-AB.md` and `VERIFY-D.md`) share one
theme: a local listener or local egress path that trusts more than it should, and a containment
layer that trusts a path string instead of the file it names.

- **DEP-02 (Medium).** File-read containment layer ① is a lexical `path.relative`
  (`server/src/lib/path-containment.ts:55-58`, used `:161-163`). `fs.open` then follows an in-cwd
  symlink to any user-readable file, so `GET /api/file` (tier `observe`, `networkGuard` only,
  `server/src/routes/file-routes.ts:726-727`) serves `~/.ssh/id_rsa` through `<cwd>/link`.
  Planting: the agent (`bash ln -s`) or a symlink committed in a cloned repo. The
  `/api/session-file` in-cwd shortcut (`server/src/routes/session-routes.ts:538-563`) skips
  containment entirely and reads the same way.
- **ELEC-01 (Medium).** The main `BrowserWindow` uses Electron's default session and nothing in
  `packages/electron/src` installs a permission handler for it (`main.ts:605-618`); Electron's
  default approves every request. In remote mode the page is remote-server content; in local mode
  it is any plugin client bundle or an XSS. Server windows (own partition) already deny by
  allowlist (`lib/server-windows.ts:85-90,575-576`).
- **NET-02 (Low standalone; the planting step for HTTP-02).** `serve_mockup` listens on `0.0.0.0`
  for an agent-chosen directory with no auth, no Host check, no dotfile filter and symlinks followed
  (`packages/mockup-loop/src/extension.ts:112,227-237`); the path gate does not see the tool
  (`extension/src/path-gate/handler.ts:40`). The tool text tells the agent to hand the URL to the
  human (`extension.ts:200`): that is a page on a localhost port, the HTTP-02 road.
- **NET-03 (Low).** The document converter publishes PlantUML (`:latest`) and Gotenberg with
  `docker run -p <port>:<cport>` (all host interfaces, bypassing host firewalls) for the length of a
  conversion (`document_converter/pdf_server.py:177`, `plantuml_server.py:167`). A stopped container
  from an older version is reused with `docker start` and keeps its wildcard publish
  (`pdf_server.py:220-221`).
- **NET-04 (Low, operate tier only).** `POST /api/providers/test` resolves `***` + `name`
  (`providers.json`) or `$ANY_ENV` and sends the value to a caller-chosen `baseUrl`, and gives a
  semi-blind GET SSRF with no link-local/metadata block (`server/src/routes/provider-routes.ts:573-610`,
  `server/src/package/provider-probe.ts:131-153,253`). The raw finding's MCP-session road is false:
  `providers_test` is tier `operate` and `dispatch.ts:520` refuses `control` session tokens.

## What Changes

Decisions D1–D7 are confirmed by operator 2026-10-26 (`/tmp/secmap/batch2/DECISIONS-C.md`); the text below
is the recommended shape.

- **DEP-02 (D1, D2).** Layer ① admits a path only when it is lexically under the anchor **and** its
  real path is under the anchor's real path; an escaping link falls through to layer ② / grants /
  the existing remedy (which already names a real-path subject). One edit in `isAllowed` also fixes
  the grep filter and mention resolver (both use `decidePassive` → `isAllowed`). `/api/session-file`
  loses its lexical shortcut and always decides through `evaluateContainment`. The decision carries the decided real path (grant and post-hold decisions too: `isGrantAdmitted` and `reEvaluate` return it) and the three file gates return it as `real`. The checked openers (`openStateChecked`, `readFileStateChecked`, `openVerifiedRegularFile`) take it as an optional argument and refuse a handle that is not that file (post-open `realpath` equality + `(dev,ino)`); programs handed a path (`rendered-pdf` via `toPdf`, `open-in-system`/reveal) get the real path, and `rendered-pdf` re-checks `(dev,ino)` after conversion.
- **ELEC-01 (D3).** One default-deny permission policy on `session.defaultSession`, installed before
  any window is created: only `clipboard-sanitized-write`, `notifications`, `fullscreen`, only for
  the main frame of the main window's current origin (its live URL, accepted only if `navigateToServer` would load it; a service-worker notification check is judged by origin alone); `openExternal` stays denied. The allowlist constant moves to a shared module used by server windows too.
- **NET-02 (D4, D5).** `serve_mockup` binds `127.0.0.1`; `lan:true` is the explicit opt-in for
  `0.0.0.0`. Every URL carries a random path token; loopback mode checks the Host header; dotfile
  path segments and symlink escapes are refused; `dir` must resolve inside the session cwd (`ctx.cwd`). A malformed request path answers 400 (was a 500 with a reflected error string).
- **NET-03 (D6).** `docker run -p 127.0.0.1:<port>:<cport>` for both containers; a running or stopped container whose configured binding (`docker inspect`, works while stopped) is not loopback is removed and recreated.
- **NET-04 (D7).** `***` resolves only when the body `baseUrl` equals the saved provider's;
  `$ENV` resolves only when a saved provider with that `$NAME` key has the same `baseUrl`; every provider probe (Test, post-save/refresh probe, model discovery) vets its target through `resolveAndVet` at one choke point (refuses link-local/metadata and the dashboard's own port; loopback and LAN stay allowed), closing the save-then-probe road.
- **Docs.** README (`serve_mockup` row), CHANGELOG `Unreleased` (Security + BREAKING),
  `docs/security/residual-risks.md` and chapters via DocScribe.

**BREAKING:**

1. Symlinks inside a session cwd (or `~/.pi`) whose real target is outside every checkout root and
   grant now answer 403 with the grant remedy instead of serving (`pnpm link`, `~/shared` links); a link whose real target is a forbidden grant subject (`~/.ssh`, `~/.pi`, `$HOME`, system roots; `shared/src/forbidden-subjects.ts:113-120`) answers 403 with no grant possible (`ungrantable`).
2. `serve_mockup` URLs gain a token path segment (root-relative asset links such as `/style.css` stop resolving; use relative links); no LAN URL unless `lan:true`; `dir` outside the session cwd is refused.
3. Electron main window: no permission except the three above (camera/microphone `media`,
   geolocation, `clipboard-read` … denied). The planned voice-assistant browser mic source needs its
   own entry.
4. Provider Test: an unsaved `$ENV` key and a `***` key with an edited Base URL answer an actionable error instead of probing; a saved provider pointing at a link-local/metadata address is no longer probed.
5. Document converter: legacy wildcard-published containers are recreated on next use.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-read-containment`: MODIFIED "File-read containment anchors at the git common root with a
  layered cwd fast path" (rule 1, the unchanged-layers sentence, and the session-directory wording now that the in-cwd shortcut is gone) and "Containment decisions are
  bound to the path they decided" (permitted-differences list gains the real-path refusal; decision
  carries `real`) — both copied from the stacked `close-security-map-high-findings` delta, not main; ADDED "Layer ① is decided on real paths"
  and "An opened handle is the file containment decided".
- `electron-renderer-hardening`: ADDED "The app default session denies permissions except a fixed
  allowlist for the main window's origin".
- `mockup-loop-preview-and-capture`: MODIFIED "Serve a mockup directory over static HTTP" (also states that the Purpose's LAN reachability holds only with `lan:true`; a delta cannot change a Purpose line); MODIFIED "Static file resolution and safety".
- `document-converter`: ADDED "Helper containers publish on loopback only".
- `provider-connection-test`: MODIFIED "Server exposes POST /api/providers/test" (states the Base URL normalisation rule); MODIFIED "Test button on the custom-endpoint surface" (scenario "Test works for already-saved providers": edited Base URL + `***` is refused); ADDED "Probe secrets and targets are bound to saved configuration".

## Impact

- Shared: `shared/src/containment-guard.ts` (`PathDecision` brand gains `real`; `containment-gate.ts:75` is an alias).
- Server: `lib/path-containment.ts` (`isAllowedReal`; `isGrantAdmitted` returns the real path), `access/containment-gate.ts` (`decision()`, `reEvaluate` return `real`), `lib/dashboard-state-guard.ts` (`openStateChecked`/`readFileStateChecked` optional arg), `access/verified-read.ts`, `routes/file-routes.ts` (incl. the two EML routes passing bound bytes), `routes/session-routes.ts` (callers pass the decided real path), `routes/provider-routes.ts`, `package/provider-probe.ts` (vet choke point), `server.ts` (one self-port registration), `push/push-transports/webhook-url.ts` (error noun only). `lib/eml.ts` and `live-server/live-static.ts` are not edited (no decision in scope / already real-path rooted).
- Electron: `main.ts`, new `lib/permissions.ts`, `lib/server-windows.ts` (imports the shared constant).
- Mockup loop: `src/extension.ts`, README. Document converter: `pdf_server.py`, `plantuml_server.py`.
- No route, tier, wire-format or config-schema change. Migration/rollback/compat: see design.

## Discipline Skills

- `security-hardening` — symlink-safe containment, default-deny permissions, local listener
  exposure, SSRF/secret binding.
- `doubt-driven-review` — D1/D2 narrow a path every file route shares and set a compatibility line
  (symlinked workspaces); review before it stands.
- `observability-instrumentation` — one `info` line per serve_mockup start (bind, lan flag, root), a
  `warn` per denied Electron permission (permission + origin, once per pair) and per recreated legacy
  container, a `warn` per refused provider-test target (host class, never the URL query or key).

## Ownership / not in scope

| Finding / item | Status | Owner |
|---|---|---|
| HTTP-02 localhost-page CORS/cookie road (consumer of NET-02's planted page) | Out of scope | `harden-http-auth-boundaries` (A) |
| DEP-01 pi agent credential files at every content site | Out of scope; this change stacks on it | `close-security-map-high-findings` |
| TOOL-04 agent `read` of credential files | Out of scope | `harden-agent-tool-guards` (D) |
| serve_mockup stays ungated by the agent path gate | **Named residual**: the tool confines itself (D5); `agent-path-confinement` is unchanged | none |
| PlantUML `:latest` mutability / digest pin | **Named residual**: no verified digest at plan time | none |
| An operate caller saving a provider config can still bind an env key to a **public** attacker URL (save-then-probe; the vet blocks only link-local/metadata/own port) | **Named residual**: operate already equals full control of the host config | none |
| LAN-mode `serve_mockup` skips the Host check (token-only vs DNS rebinding); the dotfile rule refuses `.well-known` | **Named residuals** | none |
| DNS rebinding between `resolveAndVet` and the probe `fetch` | **Named residual**: operate-tier only; webhook transports pin via `pinnedLookup` (`webhook-url.ts:148`) | none |
| Swap-in-and-restore race inside the `open` call | **Named residual** (D2) | none |
| `/api/pi-resource-file` substring allowlist; `tree`/`exists` name listing | Unchanged residuals | `close-security-map-high-findings` |
| Hardlink inside an anchor to a file outside it (`st_nlink > 1`; served, real path is inside) | **Named residual**: needs write access the agent already has; refusing it breaks the pnpm store | none |
| `serve_mockup` `realpath`-then-open race (link swapped between check and open) | **Named residual**: the agent writes the served directory anyway; NET-02 is Low | none |
| Cloud-metadata addresses beyond the webhook set (`100.100.100.200`, `192.0.0.192`, `fd00:ec2::23`) | **Named residual**: the provider vet reuses `resolveAndVet`; widening changes webhook behaviour | none |
| Latency threshold of layer ① | Not asserted: structural budgets only (no `git` spawn, ≤ 4 `realpath` per decision) | none |
| Windows reparse points / junctions | Covered by `fs.realpath` semantics; no Windows-specific test row | none |
| ELEC-04 unsigned binaries | Out of scope | `macos-notarization`, `windows-authenticode-signing` |
