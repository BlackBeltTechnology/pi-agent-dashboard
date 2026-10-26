## Context

All paths are under `packages/` unless noted. Findings come from
`docs/security/residual-risks.md` (DEP-01 :98, TOOL-01 :95, HTTP-01 :93). All
`path:line` citations were re-verified at HEAD during plan-proposal doubt cycles 1 and 2.

### DEP-01 today

- `homePiAnchor()` = `~/.pi` (`server/src/routes/file-routes.ts:164`), appended to
  the cwd anchors at the read gate (`:443`), raw (`:1254`) and render (`:1492`);
  the mention resolver has its own copy (`server/src/lib/resolve-file-mention.ts:38`,
  used `:82`). `file-read-containment` requires this anchor
  (`openspec/specs/file-read-containment/spec.md`, anchor wording :10, :43, scenario
  :122-126, :243).
- Only carve-out: `server/src/lib/dashboard-state-guard.ts`. `tierWithin`
  (`:90`) classifies only paths inside the real `~/.pi/dashboard`; `always` =
  `local/**` + `identity.key`, everything else `gated`. `dashboardStateRefuses`
  (`:113`) is the single predicate; `handleIsAlwaysRefused` (`:154`) +
  `alwaysRefusedFiles` (`:126`) do the post-open (dev,ino) recheck;
  `isDashboardStateDirSync` (`:175`) is the sync grep-walker skip. `norm` (`:75`) is
  an unconditional `toLowerCase` ("compared case-insensitively everywhere", `:73`).
- Funnel sites that call `dashboardStateRefuses`:
  `lib/path-containment.ts:137` (`isGrantAdmitted`), `:159` (`isAllowed`),
  `access/containment-gate.ts:247` (`evaluateContainment`),
  `lib/writable-md-target.ts:104`. Grep's route gate 2 uses `decidePassive`
  (`routes/grep-routes.ts:92`) → `isAllowed`; the mention resolver uses
  `decidePassive` (`resolve-file-mention.ts:83`). Because the predicate runs before
  the anchors and before grants, a `$HOME` cwd and an operator grant cannot bypass it.
  The request caller is put in scope by one `onRequest` hook (`server.ts:3698-3703`,
  `auth/dashboard-state-caller.ts:22`).
- **GAP F1 — `/api/session-file` in-cwd shortcut.** `routes/session-routes.ts:538-563`:
  when the path is lexically inside `session.cwd` (`rel` = `relative(cwd, absPath)`
  at `:539`, no `..`), the route skips `evaluateContainment` (`:545`) and reads
  `readFile(absPath, "utf-8")` (`:563`), so `dashboardStateRefuses` is never called.
  With cwd = `$HOME`, `GET /api/session-file?path=.pi/agent/auth.json` (MCP
  `get_session_file`, tier `observe`) returns the file. The same hole reads
  `~/.pi/dashboard/local/token` (pre-existing, always-tier today). The route's
  `evaluateContainment` branch (grant admission) already runs the predicate; the
  shortcut does not. Fix in D1.
- **Post-open recheck coverage today** (`openStateChecked` `lib/dashboard-state-guard.ts:206`,
  `readFileStateChecked` `:223`). Content-serving sites and their open at HEAD:

  | Site | Open | Recheck today |
  |---|---|---|
  | `GET /api/file` (`file-routes.ts:726`) | `:757` `openStateChecked`; grant `:756` `openVerifiedRegularFile` | non-grant yes; grant NO |
  | `GET /api/file/digest` (`:815`) | `:839` raw `fs.open`; grant `:838` | NO (hash oracle only) |
  | `GET /api/file/md-read` (`:1078`) | `:1097` `fs.readFile` | NO (md-only; path-level via `isWritableMdTarget`) |
  | `GET /api/file/raw` (`:1242`) | `:1384` `openStateChecked`; grant `:1368` | non-grant yes; grant NO |
  | `GET /api/file/render` (`:1417`) | `:1529` `readFileStateChecked`; grant `:1518` | non-grant yes; grant NO |
  | `GET /api/file/rendered-pdf` (`:1559`) | converter opens the PATH (`:1582` `docxPdfEngine.toPdf`) | NO (out-of-process; `.docx`/`.pptx` only) |
  | `GET /api/file/sheet` (`:1604`) | `:1633` `readFileStateChecked`; grant `:1622` | non-grant yes; grant NO |
  | `GET /api/file/eml` (`:1658`), `eml-attachment` (`:1716`) | non-grant `lib/eml.ts:101` `fs.readFile(absPath)`; grant `:1696`/`:1750` | NO |
  | `GET /api/session-file` (`session-routes.ts:506`) | `:563` plain `readFile`; grant `:562` | NO (+ F1 shortcut) |
  | `GET /api/pi-resource-file` (`routes/openspec-routes.ts:1103-1140`) | `:1134` plain `fs.readFile` | NO, and NO state predicate at all (see GAP G1) |
  | `POST /api/file/write-binary` (`routes/file-write-binary-routes.ts`, tier `control` `shared/src/route-tiers.ts:330`) | overwrite hashes the real target through `createReadStream` (`:116-119`, called `:167`) and answers the hash on a mismatch (`:171-175`); the authorizer `isWritableHandlerTarget` (`lib/writable-handler-target.ts:45-66`) checks cwd containment + the claim extension only | NO state predicate (H6, below) |
  | plugin routes that return file content (`flows-plugin/src/server/flow-files.ts:257`, `automation-plugin/src/server/routes.ts:315,334,443,461`) | plugin-side `fs` reads | NO: plugins have no seam to the guard (H1, below) |
  | live-server static (`live-server/live-static.ts:158` `openRegular`) | `:161` `fs.promises.open` | NO. The raw-read gate runs first: `deps.gate` (`live-static.ts:154`) is `staticGate` (`server.ts:3416-3417`, `gateFilePath` → `evaluateContainment`), injected into `serveStatic` at `live-server-proxy.ts:245`; `json` is a servable extension (`shared/src/live-server.ts:111`) |
  | mention resolver (`resolve-file-mention.ts:83`) | `fs.stat` only (`:85`), no content | path-level only |
  | `tree` (`:945`), `exists` (`:1118`) | names / existence only | path-level only (`exists` of a credential path is refused by the shared predicate, G3) |
  | open-in-system / reveal (`:926`, `:932`) | OS opens by path, no content returned | path-level only |
  | `POST /api/file/write` (`:1017`) | `writable-md-target.ts:104` | path-level; md-only |

  All grant reads go through `openVerifiedRegularFile` (`access/verified-read.ts:104`)
  and `readFileVerified`/`readFileVerifiedUtf8` (`:158`, `:168`), which have no
  state recheck.
- Grep: `rg` has no `--hidden` (`lib/grep.ts:148-157`), so hidden `.pi` is normally
  not walked; the JS fallback walks dot-dirs and `readFileSync`s every file
  (`grep.ts:228`), skipping only the state dir by name (`:220`). Matches are
  filtered by the route's gate 2 (`routes/grep-routes.ts:92`, `decidePassive` →
  path-based `isAllowed`), so a match whose own path is a credential file or whose
  real path resolves into one is dropped. **GAP G4 — hard link.** A hard link
  `<cwd>/x.txt` to `~/.pi/agent/auth.json` (same volume) has a non-credential
  name, and its real path is itself, so `dashboardStateRefuses` passes it, and
  gate 2 ships the snippet (both the `rg` and JS-fallback paths feed gate 2). The
  `(dev,ino)` identity is the only thing that catches it.
- Credential files and their writers: `plugin-credentials.json`
  (`server/src/auth/plugin-credential-store.ts:76`, hard-coded `~/.pi/agent`),
  `providers.json` (`server/src/routes/provider-routes.ts:31`),
  `system-one/auth.json` (`server/src/vault/vault-import.ts:98`), `auth.json` and
  `mcp-auth.json` (pi-owned: `<agentDir>/mcp-auth.json`, pi
  `node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.js:88`).
  The dashboard hard-codes `~/.pi/agent` while pi honours `PI_CODING_AGENT_DIR`
  (`shared/src/dashboard-paths.ts:56-64`, `resolvePiAgentDir`; there is no
  `getAgentDir` in shared).
- **VERIFIED — `models.json` / `mcp.json`.** pi's `models.json` `apiKey` may be a
  literal (pi `node_modules/@earendil-works/pi-coding-agent/docs/models.md:23`: "an `apiKey` from `models.json`" is a credential source; `:65`: `apiKey` values); `mcp.json` `env`/`headers` are marked
  `x-secret` (`mcp-core/schema/mcp-config.schema.json:51,54`). No dashboard feature
  reads either through the file routes: `mcp-core` reads `mcp.json` with `fs`
  (`mcp-core/src/layers.ts:32`), the model proxy reads `models.json` with `fs`
  (`server/src/model-proxy/registry-singleton.ts`, `shared/src/models-json-reader.ts`),
  `providers.json` is read by roles/automation/system-one/grammar plugins with `fs`
  (`roles-plugin/src/server/roles-routes.ts:56`, `automation-plugin/src/server/model-resolver.ts:5`).
  The client shows the global `mcp.json` path only as text
  (`client/src/components/settings/RadiusMcpOffer.tsx:20,112`); a repo-wide grep of
  client, plugin client code and skills for `api/file` combined with
  `models.json|mcp.json|auth.json|providers.json` finds no caller. The only
  `/api/file*` path into the agent dir with a global scope is `.md`/`.mdx`: the
  md-read route admits it through `isWritableMdTarget` (`file-routes.ts:1091`;
  write `:245`), whose global root is `~/.pi/agent` (`lib/writable-md-target.ts:75`)
  and which already calls `dashboardStateRefuses` (`:104`); the picker is
  `lib/md-candidates.ts:12`. (The comments at `file-routes.ts:1008,1073` describe
  this but are not the code.) The other route into the agent dir is
  `/api/pi-resource-file` (G1, below); its callers read skill/flow/agent files
  (`skill-atlas-plugin/src/client/atlas-api.ts:25`, `flows-plugin/src/client/flow-files.ts:47`),
  none a credential file. Result: included.
- **GAP G1 — `GET /api/pi-resource-file`** (`routes/openspec-routes.ts:1103-1140`,
  tier `observe` `shared/src/route-tiers.ts:207`, MCP tool `getpi_resource_file`
  `mcp-server-plugin/src/server/tools.manifest.ts:164`). The path is `path.resolve`d (no `realpath`), admitted by
  a prefix/substring allowlist (`~/.pi/agent/` prefix `:1121`, `<knownCwd>/.pi/` prefix `:1122-1124`,
  `.pi/git/` substring `:1125`, `node_modules/` substring `:1126`) and read with plain
  `fs.readFile` (`:1134`). It calls **no** `dashboardStateRefuses`: an `observe`
  caller reads `~/.pi/agent/auth.json` outright (agent-dir prefix), and a session
  with cwd = `$HOME` admits `~/.pi/dashboard/config.json` and
  `~/.pi/dashboard/local/token` through the `<cwd>/.pi/` prefix. A symlink under
  `node_modules/` or `.pi/` to a credential file is admitted lexically too. Fixed
  in D1; the prefix allowlist itself is not redesigned (its substring looseness is
  a DEP-family residual).
- **GAP H6 — `POST /api/file/write-binary`** (`routes/file-write-binary-routes.ts:116-119,167`).
  Editor-pane file handlers save through it. The target authorizer
  `isWritableHandlerTarget` (`lib/writable-handler-target.ts:45-66`) admits a real path
  inside the admitted cwd whose extension the claim lists, and — unlike
  `isWritableMdTarget` (`lib/writable-md-target.ts:104`) — never calls
  `dashboardStateRefuses`. `overwrite` then hashes the real target (`sha1OfFile`
  `:116-119`, `:167`) and returns that SHA-1 in the 409 body when it differs from
  `expectSha1` (`:171-175`): a hash oracle on any file the authorizer admits, plus an
  overwrite of it. Exposure today is latent: no first-party edit claim lists `.json`
  (claimed edit extensions at HEAD: `.deckcraft .designcraft .docx .dxf .fakecraft
  .fcproj .jpeg .jpg .pdf .png .pptx .psd .scraftz .svg .tif .tiff .webp .xlsx`, from the
  `pi-dashboard-plugin.claims` of `packages/*/package.json`), but a hard link
  `x.docx` → `auth.json` passes the extension test on its own name and yields the
  oracle, and a third-party claim listing `.json` would add the overwrite. Tier
  `control`. Fixed in D1.
- **GAP H1 — plugin-registered routes that read files.** Plugins mount their own routes
  on the host fastify (`ctx.fastify`) and read with plain `fs`; the guard is not
  reachable from them. Evidence: `flows-plugin` depends only on `plugin-runtime`,
  `client-utils` and `shared` (`flows-plugin/package.json:110-113`) while the guard lives
  in `server/src/lib/dashboard-state-guard.ts`; a plugin receives `ServerPluginContext`
  members only (`flow-files.ts:169-176`, wired `flows-plugin/src/server/index.ts:82-88`),
  none of which touches containment (`networkGuard`, `server-context.ts:1217`, decides
  network access only). The request caller IS in scope for plugin routes — the
  `onRequest` hook that runs the whole lifecycle inside `runWithStateCaller`
  (`server.ts:3702-3704`) is registered before plugins load (`server.ts:4691`) and
  plugin routes live on the same instance — so a host-provided function can apply the
  guard on their behalf. The one concrete exposure is `GET /api/plugins/flows/file`
  (tier `observe`, `shared/src/route-tiers.ts:233`): the extension filter is applied
  to the NAME the session's bridge reports (`flow-files.ts:34-36`, `:62-70`), then the
  allow-list maps that name to its `realpath` (`canonical` `:54`, `allow` `:112-114`)
  and `readFile` reads the target (`:255-257`), so a reported `x.md` that is a symlink
  to `~/.pi/agent/auth.json` is served. Fixed in D1 through a new context member.
  Audit verdicts for every plugin route that reads files are in D1.
- **VERIFIED — grep walker.** Content cannot surface by *path* (gate 2) once the
  predicate covers the set, but the JS walker reads the files and gate 2 cannot see a
  hard link; D1 adds a file-level skip and an identity filter (G4).
- **VERIFIED (G5) — fragments and backups** (pi `@earendil-works/pi-coding-agent` 1.4.0 installed). pi reads exactly `<agentDir>/models.json`
  (`pi-coding-agent/dist/core/agent-session-services.js:59`, load/parse
  `dist/core/model-config.js:117-150`) plus its own `models-store.json`, a
  refreshed provider-catalog cache (`dist/core/models-store.js:25-31`), not a
  credential file. A literal search of pi's installed `dist/`, `docs/` and `*.ts`
  for `models.json.d` finds **no** reader: pi does not load `models.json.d/`
  fragments, so no fragment directory joins the set. (A regular JSON file named
  `models.json.d` exists on the dev machine; it is covered by the `<name>.*`
  sibling rule.) `~/.pi/agent/backups/**`: neither pi (no `backups` literal in
  `dist/` or `docs/`) nor the dashboard (no `agent/backups` writer in `packages/`)
  creates it; on the dev machine it holds tool-made leftovers
  (`backups/mcp-adapter-leftovers-*/`). Contents are tool-dependent and may hold
  credential copies. **Recorded as residual**, owner none; `<name>.bak*` siblings of
  the fixed names are refused by the sibling rule.
- **VERIFIED — TOOL-04.** Agent-side `read` is guarded by the path gate
  (`extension/src/path-gate/roots.ts:132`: agent dir is a read-only root,
  `decide.ts:71`). `encrypt-credentials-at-rest` `credential-file-guard` protects
  `plugin-credentials.json` and vault files only
  (`openspec/changes/encrypt-credentials-at-rest/specs/credential-file-guard/spec.md`,
  "Protected credential paths") — **not** `auth.json`, `mcp-auth.json`,
  `providers.json`. TOOL-04 is therefore only partly owned; it is not closed here.

### TOOL-01 today (premise corrected, finding re-rated Low)

- Manifest row `prompt_response`: tier `control`, `bind:{kind:"session",
  message:"prompt_response"}` (`mcp-server-plugin/src/server/tools.manifest.ts:132`;
  generated `generated/tools.ts:128`, `shared/src/mcp/verb-tiers.generated.ts:107`).
  Session tokens resolve to `{kind:"session", tier:"control"}` (`tokens.ts:46,123`).
  The self-target guard runs for every row flagged `sessionTargeting`
  (`dispatch.ts:552`, `guard.ts` `evaluateSelfTarget`) and refuses only
  caller-session = target-session.
- **VERIFIED — no MCP road answers a prompt today.** The chain, each hop read at HEAD:
  1. `executeSession` (`mcp-server-plugin/src/server/dispatch.ts:622-633`) builds
     `{type:"prompt_response", sessionId, ...rest}` and hands it to `deps.sendToSession`.
  2. `mcp-server-plugin/src/server/index.ts:169`: `sendToSession: (sessionId, message) => ctx.sendToSession(sessionId, message as never)`.
     The `as never` cast defeats the plugin API type `SendToSessionFn =
     (sessionId, text: string) => boolean`
     (`dashboard-plugin-runtime/src/server/server-context.ts:126`).
  3. Host `server.ts:4166-4167`: `sendToSession: (sessionId, text) =>
     piGateway.sendToSession(sessionId, { type: "send_prompt", sessionId, text })` —
     the message OBJECT becomes the `text` field of a `send_prompt`.
  4. The bridge receives a `send_prompt` (`extension/src/command-handler.ts:672`),
     never a `prompt_response`, so it never reaches `promptBus.respond`
     (`extension/src/bridge-handlers/dispatch.ts:359-368`).
  Net: the tool cannot answer anything. What it does do is inject a malformed prompt
  (object as text) into the target session — within what `send_prompt` (same tier,
  same road) already grants. Runtime effect is a static trace only; not executed.
- **Why the register's High was wrong.** `docs/security/tool-call-guards.md:207` and
  `residual-risks.md:255` assumed the verb reaches the bridge unwrapped (they flagged
  it "Needs verification end-to-end"). The trace shows the host re-wraps it. The
  finding is re-rated **Low (broken tool)**; the defect worth recording is the
  broken bind, not an answer bypass.
- The same `session` bind is shared by `set_session_tags` (`tools.manifest.ts:131`),
  `edit_followup_entry` (`:133`) and `history_backfill` (`:134`), all broken the same
  way. None answers a prompt; they are not touched here (residual, owner none; a
  follow-up should fix or remove the `session` bind kind).
- **VERIFIED — `extension_ui_response`.** The MCP tool exists as a REST row
  (`tools.manifest.ts:55` → `POST /api/session/:id/extension-ui-response`,
  `server/src/session/session-api.ts:653-675`; the denylist entry `:160` only
  names the duplicate bridge verb). It clears `pendingUiRequests` and forwards
  `extension_ui_response` to the bridge, which drops it (`bridge-handlers/dispatch.ts:143`
  "Legacy … removed"); the `extension_ui_request` producer is gone (comment-only at
  `server/src/event-wiring.ts:2434`; `server/src/pairing/browser-gateway.ts:811` is
  the remaining replay code and `:822` only a comment calling that leg dead). The
  road is inert today.
- **Precedent for refusing an MCP answer road.** `tools.denylist.ts:140-141`
  (`/api/questions`, `/api/questions/`: "agent prompt answers stay human-in-the-loop;
  follow-up") and `grant_response` (`:171`, "operator-only answer to an access prompt;
  self-approval risk"), `provision_response` (`:189`).
- **Completeness contract.** `server/src/__tests__/mcp-manifest-completeness.test.ts`
  (E15) proves every REST route and every `BrowserToServerMessage` verb is either bound
  by a manifest row or `isDenylisted` (exact match unless the pattern ends in `/`,
  `tools.denylist.ts` `isDenylisted`). The WS verb `prompt_response` is a
  `BrowserToServerMessage` member (`shared/src/browser-protocol.ts:2119`); the REST
  route `/api/session/:id/extension-ui-response` is tiered at
  `shared/src/route-tiers.ts:462`. Removing their manifest rows therefore REQUIRES
  denylist entries for `prompt_response` (verb) and the REST path, and a corrected
  reason on the existing `extension_ui_response` verb entry (`:160`, currently the now
  false `duplicate-of:extension_ui_response`).
- **Codegen procedure.** The manifest is hand-written (`tools.manifest.ts`);
  `pnpm --filter @blackbelt-technology/pi-dashboard-mcp-server-plugin codegen`
  (`mcp-server-plugin/package.json:62` → `tsx codegen/generate-tools.ts`) regenerates
  `src/server/generated/tools.ts`, the README `<!-- tools:start/end -->` block
  (`mcp-server-plugin/README.md:28,193`) and `packages/shared/src/mcp/verb-tiers.generated.ts`
  (`codegen/AGENTS.md`). Freshness: `generated-freshness.test.ts` (E17, E12). Never
  hand-edit the generated files.
- **A second consumer of the tier table (chat-gateway).** `chat-gateway/src/server/team/tier.ts:87-88`
  builds `VERB_TIERS` from `GENERATED_VERB_TIERS`; `CHAT_COMMAND_ALLOWLIST` lists
  `prompt_response` (`:51`); `tierOfVerb` falls back only to the chat-local table
  (`:91-97`). The gateway authorizes a button/modal answer as verb `prompt_response`
  (`chat-gateway/src/server/gateway.ts:1219`) and then answers over a different road,
  `seam.sendPromptResponse` → `ctx.sendExtensionMessage` (`chat-gateway/src/server/seam.ts:133-138`, host `server/src/server.ts:4502`), which is untouched. Dropping the row from the generated table
  alone makes `authorize.ts:143-144` refuse every chat answer with `verb_unknown_tier`.
  The chat-local table (`tier.ts:77-85`, whose header comment states it is for
  verbs "with NO MCP counterpart") is the correct home once the row is gone — the verb
  stays a platform verb (the browser WS `prompt_response`), it only loses its MCP row.
  The chat-local tier is therefore NOT a second literal: it is read from
  `WS_MESSAGE_TIERS.prompt_response` (`shared/src/ws-message-tiers.ts:65`, accessor
  `wsMessageTier` `:134`), so it tracks the dashboard's own tier for that message. The
  existing tests `authorize.test.ts` "every allowlisted command resolves to a tier"
  and "the chat-local table never SHADOWS a platform verb" (`:45-61`) pin both halves,
  which fixes the ship order: the chat-local entry lands in the same commit as the
  manifest-row removal + codegen (D2 steps 1-4), never before (shadow) or after
  (unknown tier).
- **Repo orchestrators using MCP `prompt_response`: none.** Grep of
  `.claude/`, `.pi/agents`, `.pi/skills`, `.pi/flows`, `packages/*/skills`,
  `packages/*/agents` (incl. `claude-plugin/skills`, `eng-disciplines/agents`,
  `extension/agents`) for `prompt_response|prompt-response|extension_ui_response|
  extension-ui-response` finds no hit; the only matches are the MCP plugin itself
  and `flows-plugin` client code, which uses the browser WS verb, not MCP.
- **Residual roads, not closed here (H5).** No MCP tool answers a prompt; these roads
  remain, all of them dashboard-/operator-facing or credential-gated:
  1. Dashboard UI and the chat gateway (`seam.sendPromptResponse`, above).
  2. REST `POST /api/questions/:id/answer` (non-file kinds): an agent that holds a
     `control`-tier REST credential can answer NON-file prompts of other sessions
     (`questions/question-routes.ts:94-107`; tier `control`, `shared/src/route-tiers.ts:58`;
     file-origin prompts refused `:94`; owner-scoped by `canSee` `:58-59`).
  3. Browser WS verb `prompt_response` (`pairing/browser-gateway.ts:2418`; message
     tier `control`, `shared/src/ws-message-tiers.ts:65`): any `control` browser or
     cookie session.
  4. `POST /api/access/prompts/:promptId` (path-gate / access prompts,
     `routes/access-prompt-routes.ts:185`, tier `operate` `shared/src/route-tiers.ts:65`).
  Over loopback a bare caller needs local proof by default (`requireLocalProof`
  defaults `true`, `shared/src/config.ts:1847`, `:2822`, from archived
  `close-container-loopback-impersonation`), but a same-host agent with a shell can
  obtain the proof material itself. Owner: none (residual;
  `add-supervised-tool-approval` is the change that moves approvals off agent-reachable
  roads, and references this entry).

### HTTP-01 today

- `isUserAllowed`: empty/unset → `true` (`server/src/auth/auth.ts:279-280`).
  `resolveGroupTier`: empty `groupTiers` → `"operate"` (`auth.ts:247`). Callback:
  `auth/auth-plugin.ts:404-462`; `renderDeniedPage` `:183`. Login entry points:
  `/auth/login` with single-provider auto-redirect (`:364-381`),
  `/auth/start/:provider` (`:390`), callback (`:404`).
- **Provider keys are not a closed set.** `resolveProvider` (`auth.ts:95-125`):
  key `github` → fixed GitHub endpoints regardless of config (`:101-107`); key
  `google` → fixed issuer `https://accounts.google.com` (`:110`, `GOOGLE_ISSUER`
  `:52`); **any other key** (`keycloak`, `oidc`, or an arbitrary string in
  `config.json`) → OIDC discovery of `config.issuerUrl` (`:110-121`). Config
  validation accepts any key with `clientId`+`clientSecret`
  (`shared/src/config.ts:1932-1944`; `AuthProviderConfig` has only
  `clientId/clientSecret/issuerUrl/name`, `:125-130`). Only the Settings panel
  limits keys to four (`client/.../SettingsPanel.tsx:2521`). So an `oidc` key
  pointing at `https://accounts.google.com` is a public IdP and a key-based rule
  would miss it. `ResolvedProvider` (`auth.ts:15-24`) carries `key`, the three
  endpoint URLs, no issuer.
- Runtime reload: `_reloadAuth` (`auth-plugin.ts:283-295`) rebuilds `allowedUsers`
  and `groupTiers`; `logResolvedRedirectBase` is the precedent for a per-register
  and per-reload log line (`:262, :292`).
- **Session cookies.** Signed JWT carries `sub`, `name`, `username`, `provider` and
  `tier` only (`auth.ts:26-37`, `AuthUser`/`TokenPayload`; `signToken` `:183`); it has
  **no issuer or public/non-public claim**. OAuth logins sign `provider: providerKey`
  (`auth-plugin.ts:456-459`), passkey logins `provider: PASSKEY_PROVIDER`
  (`:357`, `auth/passkey/passkey-service.ts:76`).
  Validation funnels through `effectiveSessionTier(payload, passkeys)`
  (`auth-plugin.ts:615`): REST/`/auth/status`/health tagging via the closure at
  `:348` (`tagSessionCookie` `:495-509`, `/auth/status` `:476-489`; a `null` tier is
  `rejected` → cookie cleared + 401/redirect, `:581-600`), the WS gate
  (`authorizeWsUpgrade` `isSessionLive`, `:778`, wired `server.ts:4888`, `:4895`) and the
  live-capability liveness check (`server.ts:2383`). `validateWsUpgrade`
  (`auth-plugin.ts:623-653`) calls `verifyToken` directly but has no production caller
  at HEAD (grep). A token issued while open enrolment was allowed stays valid for its
  lifetime today.
- **WS revocation precedent (passkey).** A cookie-session browser socket carries
  `sessionTier = () => effectiveSessionTier(payload, passkeyService)` (`server.ts:4895`,
  stamped `:4983`); `decideWsTier` returns `close` when it yields `null`
  (`pairing/ws-tier-gate.ts:11,25-31`) and the gateway closes the socket with code
  `WS_CLOSE_SESSION_REVOKED` 4401 on its **next inbound frame**
  (`ws-tier-gate.ts:33`, `pairing/browser-gateway.ts:2089-2091`). It is lazy: no sweep
  exists, so an idle socket that only receives pushes survives a revoke. Terminal
  sockets (`terminal/terminal-gateway.ts:14,40`, own `wss`) are checked at upgrade
  only (`server.ts:4897-4903`) and carry no `sessionTier`. The browser gateway
  handle exposes `wss` (`browser-gateway.ts:2633`), so a sweep over `wss.clients` is
  possible.
- Posture surface: `GET /api/auth/diagnostics` (`routes/system-routes.ts:799-816`,
  tier `operate`, `shared/src/route-tiers.ts:113`), reachable over loopback; spec
  home "Resolved redirect base is diagnosable" (`oauth-authentication` spec :423).
  It reads `loadConfig()` (`:803`), **not** the live `authState`, so it is wrong after
  a failed or pending reload; `_reloadAuth` is exposed as a fastify decoration
  (`auth-plugin.ts:283`, read `system-routes.ts:810`), `authState` itself is private
  to the plugin. The client does not call the route yet. The Settings Security tab
  renders providers and the `allowedUsers` textarea
  (`client/src/components/settings/SettingsPanel.tsx:2516-2552`); its `AuthConfig`
  type lacks `groupTiers` (`:137-148`), and `groupTiers` is config-file only
  (`server/src/config-api.ts:288` merges `allowedUsers` but not `groupTiers`;
  stored value is kept).
- `keycloak-resolver-plugin` is a bearer-token resolver only
  (`keycloak-resolver-plugin/src/server/index.ts:57-60`, D18 note: no login
  descriptor); it is not an OAuth login provider and is outside D3.
  `add-social-login-broker` is a separate plugin with its own allowlist-to-tier map
  and arming guard; it does not touch this callback.
- Audit facility: `auth/audit-log.ts` `auditLine(area, verb, fields)`,
  `auditRequestFields` (`:48`, `:78`).
- Login-capable providers are exactly the entries of `authState.providerRegistry`
  (built `auth.ts:78`, a provider whose discovery fails is dropped with a warning).
  `auth-plugin.ts:242-300` keeps it in `authState`; `server.ts:2530-2539` holds the
  `hasUsableOAuthProvider` accessor from the returned handle (precedent for a live
  accessor).

## Goals / Non-Goals

**Goals**
- No caller, role or mode can read a pi-agent credential file through any server
  file route, including `/api/session-file`'s in-cwd shortcut.
- No caller can answer an agent prompt through MCP: `prompt_response` and
  `extension_ui_response` leave the MCP tool surface for every caller, on a
  recorded denylist reason, with generated artifacts regenerated and the
  chat-gateway's own answer authorization unchanged.
- No public IdP admits arbitrary accounts at `operate` — whatever key the operator
  gave it; every open-enrolment provider is visible to the operator; sessions
  already issued under open enrolment of a now-refused provider stop working.

**Non-Goals**
- WS-01, ELEC-04, PLUG-01, TOOL-04, DEP-02 (see proposal ownership table).
- Narrowing the `~/.pi` anchor (rejected, D1).
- Fixing or removing the broken `session` bind kind shared by `set_session_tags`,
  `edit_followup_entry` and `history_backfill` (Context, TOOL-01): not answer roads;
  residual, owner none, follow-up.
- Closing REST `POST /api/questions/:id/answer` for control-tier agent credentials
  (residual R-TOOL01, Context): owner none; supervised approval references it.
- `~/.pi/agent/backups/**` and other tool-made copies of credentials under the agent
  dir (G5): not enumerable; residual, owner none.
- The substring looseness of the `/api/pi-resource-file` prefix allowlist
  (`.pi/git/`, `node_modules/` anywhere; `path.resolve` without `realpath`): a
  DEP-family residual; D1 only adds the credential-and-state refusal in front of it.
- Open-enrolment state created before upgrade (G2): passkey users, invites and
  device bearers a stranger minted while sign-in was open. Cannot be detected or
  revoked by the server; operator remedy in Migration.
- Vault file `~/.pi/dashboard/vault.json` stays in the `gated` tier (readable by a
  locally trusted caller or login session); `encrypt-credentials-at-rest` owns its
  protection.
- **Legacy plain keys in `~/.pi/agent/settings.json` are NOT covered** (F8):
  it is the primary user-editable pi file (settings editing and previews read it),
  so refusing it would break a core feature. Mitigation, not closure: the
  `pi-legacy-credentials` flow moves such keys into `auth.json`
  (`server/src/auth/pi-legacy-credentials.ts`, change `pi-settings-full-coverage`).
  Owner: none; registered as a residual of the TOOL-04 / credential family.
  Project-layer `<cwd>/.pi/mcp.json` is also not covered (inside the session cwd).
- **Relocated agent dir is read from the SERVER process env only** (F10):
  `PI_CODING_AGENT_DIR` of the server (plus the default `~/.pi/agent`). A session
  whose pi runs with a different `PI_CODING_AGENT_DIR` (spawn env override) keeps its
  credential files outside the set; the operator must start the server with the same
  variable. Residual, documented.
- Revoking already-issued sessions of a still-allowed open provider when an
  allowlist is *edited* (CRED-03): not in scope (F6 residual).
- **Live-preview sockets** (`/live/*` WebSocket upgrade, `case "live"`,
  `handleLiveServerUpgrade` `server.ts:5029`) are capability-URL scoped (the
  `liveCap.prefix` passed at `:5032`), not session-tier: they carry no `sessionTier` and
  are NOT swept on an auth reload; a refused provider's cookie still cannot open a new
  one (`isSessionLive`, `:4888`), and an open one ends at the ticket's expiry
  (`scheduleAtExpiry`, `:5027`). Residual, owner none.
- The prompt-answer roads that remain after D2 (REST questions, browser WS
  `prompt_response`, `POST /api/access/prompts/:promptId`; Context, TOOL-01): owner none.

## Decisions

### D1 — Credential files join the always-refused tier

**Choice.** In `dashboard-state-guard.ts` add `AGENT_CREDENTIAL_NAMES`
(`auth.json`, `mcp-auth.json`, `providers.json`, `plugin-credentials.json`,
`models.json`, `mcp.json`, `system-one/auth.json`) and a directory set =
`resolvePiAgentDir()` (server env) ∪ `<home>/.pi/agent`, de-duplicated on real path
(the dashboard hard-codes the latter; pi uses the former — covering both mirrors the
credential-guard's two-path rule). Then:

- `isDashboardStatePath` returns `"always"` when the real target equals the
  real path of `<dir>/<name>` or its basename starts with `<name>.` in the same
  directory (quarantine/backup siblings: `.corrupt-*`, `.bak`, `.tmp`). Only the entry
  whose OWN basename matches is refused: a file inside a directory named `<name>.*`
  (`models.json.d/frag.json`) is admitted (G4; the hard-link/swap recheck still
  catches an identity match). Pinned by a test so a later widening is deliberate;
  the set stays fixed and auditable (no glob).
- **Case rule (F17).** Exact compare on a case-sensitive volume (a distinct file
  `Auth.json` is not the credential), case-folded only where the volume folds
  (macOS/Windows: `Auth.json` IS `auth.json`). The guard's existing `norm`
  (`dashboard-state-guard.ts:75`) folds unconditionally and accepts over-refusal
  inside the dashboard dir; for credentials the same `norm` is applied *only* to
  directories whose volume was probed as folding (one cached `stat` of the dir with
  swapped case, comparing dev/ino; a failed probe counts as folding — over-refuse,
  never under-refuse). The post-open (dev,ino) recheck is independent of case and
  catches whatever the name compare misses. **Test selection (G1):** no production
  seam. Tests drive the probe by spying `fs.promises.stat` of the swapped-case name
  (same `{dev,ino}` = folding; ENOENT = sensitive; throw = probe failure = folding),
  plus real-volume twins guarded by `it.skipIf` on a runtime probe (case-sensitive
  tmpdir on Linux, folding on macOS/Windows).
- `alwaysRefusedFiles` also lists those files and the siblings found by one
  `readdir` per agent dir, so `handleIsAlwaysRefused` rechecks (dev,ino) after
  open (hard links and swapped symlinks).
- **Post-open recheck at EVERY content-serving site (F7).** Instead of patching
  nine call sites one by one, the recheck is made structural:
  1. `openVerifiedRegularFile` (`access/verified-read.ts:104`) calls
     `handleIsAlwaysRefused(handle)` after its own `handle.stat()` and throws
     `VerifiedReadRefused` (new reason `"state-file"`). This covers every grant read:
     `/api/file` (`:756`), digest (`:838`), raw (`:1368`), render (`:1518`), sheet
     (`:1622`), eml/eml-attachment (`:1696`, `:1750`), session-file (`:562`).
  2. Non-grant opens that today use raw `fs.open`/`fs.readFile` switch to
     `openStateChecked`/`readFileStateChecked`: digest (`:839`), md-read (`:1097`),
     `loadParsedEml` (`lib/eml.ts:101`, via a handle read), live-server static
     `openRegular` (`live-server/live-static.ts:161`), session-file (`:563`),
     `/api/pi-resource-file` (`routes/openspec-routes.ts:1134`).
     `/api/file` (`:757`), raw (`:1384`), render (`:1529`), sheet (`:1633`) already
     do. Refusal shapes (G2): sites with no refusal shape for this case today
     (digest, md-read, eml, eml-attachment, rendered-pdf) answer 403
     `{success:false,error:"path outside working directory"}`, identical to the
     `/api/file` and raw siblings (`file-routes.ts:792`, `:1386-1389`, mapping
     `DashboardStateRefused`); live-server static answers its only not-servable shape,
     404 `{error:"live-server target not found"}` (`live-server-proxy.ts:226`
     `notFoundReply`, `live-static.ts` `openRegular` returns null). Never 2xx, never 500.
  3. Out-of-process converter (`rendered-pdf`, `:1582`): cannot take a handle. The
     decision is path-level on the real path; `openStateChecked` is run immediately
     before the converter call to narrow the window. Residual: a swap in the
     remaining gap; the converter only accepts `.docx`/`.pptx` and its output is a
     PDF rendering, never the file bytes.
  4. Path-level only, by design: mention resolver (stat, no content), `tree`,
     `exists`, open-in-system / reveal. **Names of the credential files are not
     secret** (fixed, well-known paths documented in this very change), so `tree` MAY
     list them (G3). `exists` shares the always-tier containment predicate with every
     other site, so `exists` of a credential path is refused like a content read
     (`"path outside cwd"`): no extra code, and no existence oracle. Only content is
     protected in `tree`.
  5. Writes: `writable-md-target.ts:104` refusal covers the extended set; it applies
     to markdown targets only (the write route admits only markdown extensions,
     and `<name>.*` siblings such as `auth.json.md` are refused). Non-markdown writes
     to these files through the file routes do not exist.
- **`/api/session-file` (F1).** Before the `rel` shortcut,
  `routes/session-routes.ts` decides `dashboardStateRefuses(absPath)` (real path;
  always tier **and** trust-gated tier, the caller being in scope from the
  `onRequest` hook) unconditionally, refusing with the route's existing
  `"path outside session directory"` 403. The content is then opened through the
  rechecked opener (`readFileStateChecked` for the non-grant branch,
  `readFileVerifiedUtf8` including the new recheck for the grant branch). Net:
  cwd = `$HOME`, path `.pi/agent/auth.json` → 403; this also closes the
  pre-existing in-cwd read of `~/.pi/dashboard/local/token`.
- **`GET /api/pi-resource-file` (G1).** The prefix allowlist is kept as is (its
  looseness is a recorded residual). After it admits a path, the route runs
  `dashboardStateRefuses(normalizedPath)` on the REAL path — **both tiers**, so
  `~/.pi/agent/auth.json` is refused for every caller and, with a session whose cwd is
  `$HOME` (the `<cwd>/.pi/` prefix), `~/.pi/dashboard/config.json` is refused for an
  unproven caller and `~/.pi/dashboard/local/token` for everyone. A refusal answers
  the route's existing 403 `"path not in allowed resource location"`. The content is
  read with `readFileStateChecked` instead of `fs.readFile` (`:1134`) so the
  post-open (dev,ino) recheck applies. A symlink under `node_modules/` or `.pi/`
  that resolves to a credential file is decided on the real path, hence refused.
- **Grep (G4 + walker).** `isAgentCredentialFileSync(full)` (basename pre-filter,
  then `realpathSync` compare) is used by the JS grep walker before `readFileSync`
  (`grep.ts:228`) so a credential file addressed by name or symlink is never read. In
  addition, route gate 2 (`routes/grep-routes.ts:92`, covering both the `rg` and the
  JS-fallback matches) drops every match whose file's `(dev,ino)` equals an
  always-refused file: the always-tier identity set that `alwaysRefusedFiles` +
  `handleIsAlwaysRefused` already build (`dashboard-state-guard.ts:126-170`) is
  factored into one reusable `identityIsAlwaysRefused({dev,ino})` and the identity
  list is built once per request, then one `stat` per DISTINCT matched path (deduped,
  bounded by the match cap). **Decision: implemented (feasible).** Evidence: the
  matched path is `path.resolve(cwd, m.path)` at gate 2 and rg returns only
  `path`/`line`/`snippet` JSON (`lib/grep.ts:113,164`), so a path-level gate cannot see a
  hard link but a `stat` can. Residual (accepted): the JS walker still reads a
  hard-linked file into memory before gate 2 discards its matches (identity is only
  knowable after the walker has the path; content is never returned); and a swap
  between the scan and the gate `stat` is the same narrow path-vs-handle window the
  converter site records.
- **`POST /api/file/write-binary` (H6).** `isWritableHandlerTarget`
  (`lib/writable-handler-target.ts:45-66`) calls `dashboardStateRefuses(real)` (both
  tiers; the credential set is in the always tier) right after it resolves the real path,
  exactly like `isWritableMdTarget` (`writable-md-target.ts:104`); the route re-runs the
  same authorizer under the write lock (`reauthorize`, `:154`), so overwrite and
  re-authorization are both covered, and `sha1OfFile` (`:116-119`) reads through
  `openStateChecked` so a hard link to a credential file yields neither bytes nor a
  hash. The existing `403 "target is not a writable handler file in scope"` is the
  refusal shape. Copy mode creates new files and never reads a credential file's bytes
  (the source is only `stat`ed, `:219-226`).
- **Plugin-registered file routes (H1).** Seam: one OPTIONAL member on
  `ServerPluginContext`, `readFileGuarded?(absPath): Promise<string | null>`
  (`dashboard-plugin-runtime/src/server/server-context.ts`, beside `networkGuard`
  `:1217`; deps `:1411`; built `:1538`; precedent for optional members:
  `isPiExtensionInstalled`). The host implements it where the other host-bound members
  are built (`server.ts`, beside `mintSpawnToken` `:4370`): `null` when
  `dashboardStateRefuses(absPath)` (real path, both tiers, caller from the
  `onRequest` scope), else `readFileStateChecked(absPath, "utf-8")` (post-open
  (dev,ino) recheck). Not trust-gated: it only narrows what a plugin may read. A plugin
  route that gets `null`, or finds the member absent on an older host, refuses — it
  never falls back to plain `fs`. Rejected alternatives: exporting the guard module
  to plugins (a plugin → `server` package dependency; breaks `plugin-core-boundary`
  direction and the caller scope would be the plugin's); a shared reimplementation
  (a second predicate that drifts).

  **Plugin-registered file routes — audit verdicts** (`rg -n "readFile|readFileSync|
  createReadStream|fs\.open|readSync" packages/*-plugin/src/server`, tests and the
  vendored playwright tree excluded; every hit classified):

  | Route / reader | Path comes from | Verdict |
  |---|---|---|
  | flows `GET /api/plugins/flows/file` (`flow-files.ts:240-262`) | session bridge report → `realpath` | **FIX** via seam (task 1.11) |
  | flows `GET /api/plugins/flows/flow-inputs` (`flow-inputs.ts:48-77`, `:94-113`) | `<admitted cwd>/.pi/flows/flows/<ns>/<name>/flow.yaml`, traversal id refused (`:42`, `:104`) | accepted: response is a projection (input name/type/required), not content |
  | flows `codeHandlerPaths` (`flow-files.ts:81`) | reported flow source | accepted: parse only, feeds the allow-list, no bytes returned |
  | automation `GET .../result` (`routes.ts:315,334`), `GET .../definition` (`:443` `automation.yaml`, `:461` `prompt.md`) | fixed file names under the admitted cwd; run id `isSafeRunId` (`run-store.ts:85-86`), automation name `isValidAutomationName` (`routes.ts:432`) | **FIX** via seam (task 1.12): a symlinkable file inside the cwd is returned verbatim |
  | automation `scanner.ts:47`, `run-store.ts:60`, `engine.ts:93`, `action-registry.ts:239` | scheduler/engine internals | accepted: content goes to the agent session, never to a client (an absolute `action.prompt` is operator-authored, TOOL-04 family) |
  | team `static.ts:34` | request path under the plugin's own dist | accepted: `realpath`-contained in the dist root (`:43`, `:64-65`) |
  | team `skills-service.ts:175-176,330` | operator-managed skill dirs | accepted: first 8 KiB, frontmatter key/values only (`:34`) |
  | team `store.ts`, `users.ts`, `records.ts`, `projects.ts` | plugin-owned store paths | accepted: fixed |
  | kb `kb-routes.ts:199` | `dox-staleness.json` row paths | accepted: SHA-256 compared, only a count is returned (`:487`) |
  | roles `roles-routes.ts:56,69`, system-one `llm-caller.ts:37,42` (`providers.json`) | fixed `~/.pi/agent/providers.json` | accepted: parsed to the role map, never returned raw |
  | system-one `config-io.ts`, `consumers.ts`, `supervisor.ts`; blackhole `config-io.ts`, `pipeline-reader.ts`; hermes-memory `config-io.ts` (`resolveHermesConfigPath(env)`, `index.ts:61`); context-mode-settings `settings-io.ts`; grammar `index.ts:41`; goal `goal-store.ts`; subagents `producer-file.ts`; browser `operator-hosts.ts`, `dedicated/chrome-process.ts`; craft-web `post-install.ts`, `shim.ts`; gmail `setup/capture.ts` | fixed or server-env-resolved plugin paths | accepted: no request-supplied path |
  | claude, skill-atlas, mcp-client, keycloak-resolver, mcp-server, obs-studio, quota, web-access, demo, fixture-policy, flows-anthropic-bridge | none (no file-read call in `src/server`) | n/a (skill-atlas and flows clients read through `/api/pi-resource-file`, guarded in D1) |

  Two FIX rows, one seam; every other verdict is recorded so the next route added to
  a plugin is audited against the same table (task 1.13).
- **Grant layer (G3).** The predicate already runs before the grant layer
  (`lib/path-containment.ts:137` `isGrantAdmitted`, `access/containment-gate.ts:247`),
  so no operator grant can admit a refused file. `path-anchor-grants` "A grant admits
  its own subtree and nothing more" is MODIFIED to say so explicitly and gains a
  scenario (grant over `~/.pi/agent` does not admit `auth.json`).
- No change to `homePiAnchor()` (two copies stay). `file-read-containment` gets three
  MODIFIED requirements only to reword the anchor/exception text that named just the
  dashboard state dir (:10, :122-126, :243), to record that the session-directory
  site runs the refusal before its in-cwd shortcut, and to make the "unchanged" wording
  of "Containment decisions are bound to the path they decided" relative to its
  originating change (the later credential-and-state refusals and the grep identity
  filter are permitted differences; H7). The predicate already precedes
  the anchors and grants.
- Internal callers with no request in scope are also refused (the always tier has
  no caller dependence); the audit in task 1.x checks no internal code reads these
  files through containment helpers (known readers use `fs` directly, see Context).

**Alternatives considered.**
- *Narrow the `~/.pi` anchor* (user-rejected): breaks mention preview of
  skills/prompts/extensions and every cwd=`$HOME` case still contains the files;
  the denylist is the only layer that covers the cwd anchor.
- *Tier by operate/observe*: a refusal that depends on the caller keeps a path for
  `operate` sessions and for anyone who obtains them; the files have no UI reader,
  so there is nothing to preserve.
- *Glob `*.json` in the agent dir*: refuses `settings.json`, `trust.json` etc. that
  features may open; a fixed set is auditable.
- *Also refuse `settings.json`* (F8): rejected — primary user-editable file.

**Trade-offs.** An operator can no longer open `~/.pi/agent/models.json` or
`mcp.json` in the editor pane or any file route (no dashboard UI links to them as
files; they have dedicated Settings pages and a terminal). A new pi credential file
name needs a one-line addition (documented in the guard's header comment and in
`docs/security/residual-risks.md`). One extra `stat` per volume probe and one
`readdir` per agent dir per open.

### D2 — Remove `prompt_response` and `extension_ui_response` from the MCP surface

**Choice.** Agent prompt answers stay human-in-the-loop. Both answer tools leave the
MCP tool surface for **every** caller (session token or device token), mirroring the
`/api/questions` and `grant_response` precedent:

1. Delete the two rows from `MANIFEST` (`tools.manifest.ts:132` `prompt_response`,
   `:55` `extension_ui_response`).
2. Add denylist entries in `tools.denylist.ts` (beside `grant_response`, `:171`) with
   the reason **"agent prompt answers stay human-in-the-loop; broken session bind"**
   for the verb `prompt_response`, and — because the completeness test also needs
   the REST route covered once its row is gone — for the path
   `/api/session/:id/extension-ui-response` with the reason "agent prompt answers stay
   human-in-the-loop; inert (the bridge drops the legacy message)". Replace the
   now false reason on the existing verb entry `extension_ui_response` (`:160`) with
   the same wording. The REST route itself stays registered and tiered
   (`route-tiers.ts:462`) for the browser; only its MCP exposure goes.
3. Regenerate (never hand-edit):
   `pnpm --filter @blackbelt-technology/pi-dashboard-mcp-server-plugin codegen`
   → `src/server/generated/tools.ts`, the README `<!-- tools:start/end -->` block,
   `packages/shared/src/mcp/verb-tiers.generated.ts`.
4. **Keep the chat-gateway answering.** The generated verb-tier table loses
   `prompt_response`, which `chat-gateway/src/server/team/tier.ts` reads
   (`:87-88`) and which `CHAT_COMMAND_ALLOWLIST` lists (`:51`). Declare
   `["prompt_response", wsMessageTier("prompt_response")]` in `CHAT_LOCAL_VERB_TIERS`
   (`:77-85`) — the table whose stated purpose is a verb with no MCP-manifest row. The
   tier is read from `WS_MESSAGE_TIERS.prompt_response`
   (`shared/src/ws-message-tiers.ts:65`, accessor `:134`), not written as a literal:
   today `control`, as the removed row declared, and it follows the dashboard's tier if
   that ever changes (unlisted would fail closed to `operate`). Without this,
   `authorize.ts:143-144` refuses every chat answer (`verb_unknown_tier`). The answer
   road itself (`seam.sendPromptResponse` → `ctx.sendExtensionMessage`) is untouched.
   **Ship order:** steps 1-4 land in one commit — the entry before the row removal
   trips the "never SHADOWS a platform verb" test, the removal without the entry trips
   "every allowlisted command resolves to a tier" (`authorize.test.ts:45-61`).

**Tests that must stay green** (and pin the change):
- `server/src/__tests__/mcp-manifest-completeness.test.ts` E15 (total partition over
  routes ∪ verbs; the new denylist entries are what keep it total) and the
  "denylist entries all carry a reason" check.
- `mcp-server-plugin/src/server/__tests__/generated-freshness.test.ts` E17 (generated
  tools + README fresh) and E12 (shared verb-tier file fresh and equal to
  `GENERATED_TOOLS` name+tier).
- `mcp-server-plugin/src/server/__tests__/manifest-invariants.test.ts` (E14 annotation
  and tier invariants, E18 session-targeting coverage — three `session` rows remain)
  and `tools.test.ts:97-98` (surface size bounds 100–200).
- `chat-gateway/src/server/team/__tests__/authorize.test.ts:45-61` ("every allowlisted
  command resolves to a tier" fails if step 4 is missed; "chat-local table never
  SHADOWS a platform verb" fails if the local entry is added while the row is still
  generated), `gateway-team-controls.test.ts`
  (`prompt_response` permitted at `control`) and `config-immutability.test.ts`.

**Note (H12).** The `mcp-tool-tiers` scenario keeps its legacy title "ask_user answered over MCP": renaming it to "No MCP tool answers ask_user" was tried and `openspec validate --strict` rejects it (a MODIFIED block must carry every scenario name the current spec has); only its body changed.

**Alternatives considered.**
- *Layered device road* (earlier drafts: refuse session tokens, route device tokens
  through a new trusted plugin-context answering function with the question-store
  claim and file-origin refusal): **rejected** — the premise was wrong (Context): there
  is no working road to protect, so this would ADD a working cross-session
  prompt-answering road reachable by every device token, plus a widened
  `ServerPluginContext` and a new store method.
- *Fix the bind so the answer reaches `promptBus.respond`*: **rejected** — same
  outcome, a new working answer road; contradicts human-in-the-loop.
- *Filter by token type only / by prompt type only*: rejected earlier (leaves
  cross-session answering for ordinary prompts).
- *Leave it, it is broken*: rejected — a tool that claims to answer prompts but
  injects a malformed `send_prompt` is a defect and one bind fix away from a live
  self-approval road.

**Trade-offs / compatibility.**
- External MCP clients (Claude Desktop, phone) lose a tool that never worked; they
  keep the dashboard UI, chat, REST question and access-prompt answers (Context, residual roads).
- **Version skew.** `mcp-server-plugin` is published separately
  (the host's own comment at `server.ts:1756-1758`, on the `host.verifyDeviceToken*`
  registrations `:1751-1762`: it "may run against an older/newer host"). An older plugin on a newer host still advertises `prompt_response`; calling
  it takes the same broken chain and cannot answer anything — harmless (the host
  change adds no new road). A newer plugin on an older host simply lacks the tools.
  `chat-gateway`, `shared` and `mcp-server-plugin` share the lock-step workspace
  version (`0.10.0`); an OLDER chat-gateway on a NEWER `shared` would lose
  `prompt_response` from the tier table (`verb_unknown_tier`), so the three ship in
  one release.
- Residual (recorded, Context): REST `POST /api/questions/:id/answer` can still answer
  non-file prompts for a `control`-tier credential; owner none; supervised approval
  references it.

### D3 — OAuth fail-closed for public IdPs

**Choice.** Pure helpers `classifyProviderConfig(key, providerConfig)` /
`openEnrolmentOf(...)` in `server/src/auth/auth.ts` (or `shared`). Classification is
decided from CONFIGURATION alone — the provider key and the configured `issuerUrl` —
never from OIDC discovery (H8), so a provider whose discovery failed (dropped from
`providerRegistry`, `auth.ts:78-92`) is still classified. A provider is **public** when
its key is `github` or `google` (both resolve to fixed public endpoints,
`auth.ts:101-110`), **or** the host of its configured `issuerUrl` is in the fixed set
`PUBLIC_IDP_HOSTS`: `accounts.google.com`, `github.com`, `gitlab.com`,
`login.microsoftonline.com` **only** with tenant `common`, `consumers` or
`organizations` (first path segment of the issuer, case-insensitive; a specific tenant
GUID is a single-tenant directory, not public), `appleid.apple.com`. Host compare:
parsed with `URL`, lowercased, one trailing dot stripped, ports ignored, **exact**
match (no suffix/subdomain wildcards). A provider with no `issuerUrl` and a non-built-in
key cannot log in at all (`auth.ts:111-114`) and is non-public; so is a provider whose
`issuerUrl` does not parse into a host (`"not a url"`, `"//"`, `""`; G13): there is no
host to match and login is already impossible (discovery fails), so classifying it
public would only revoke the sessions of a typo. Endpoints discovered
from the issuer are not consulted: an operator-chosen issuer is the operator's tenant
choice, and consulting them would reintroduce the dependency on discovery. Every other
issuer (unknown host, self-hosted `keycloak`) is **open**: allow-all as today plus
warning.

A provider is in *open enrolment* when `allowedUsers` and `groupTiers` are both
empty/unset (the same emptiness `isUserAllowed` and `resolveGroupTier` use, so no
drift). Mode = `"refused"` for public, `"open"` otherwise (normative; a spec scenario
pins `refused`, G11).

- Gate: `auth-plugin.ts` checks it on live `authState` at `/auth/login`
  auto-redirect, `/auth/start/:provider` (**no IdP round trip**) and
  `/auth/callback/:provider` (after the state-cookie check, before `exchangeCode`),
  returning a new `renderOpenEnrolmentPage(providerName)` (403; no identity echoed;
  names `auth.allowedUsers` / `auth.groupTiers` and where to set them) and
  `auditLine("oauth","login_refused",{provider,reason:"open_enrolment",ip})`.
- **Picker (F18).** `renderLoginPage` still lists a refused public provider but
  renders it without a sign-in link and with a "not configured for sign-in" note
  (text, not colour-only) beside the remedy; with a single refused provider the
  auto-redirect is skipped and the 403 remedy page is returned (never a bounce to
  the IdP).
- **Already-issued sessions (F6, G6).** `effectiveSessionTier` gains a third optional
  argument `isSessionProviderRejected(provider)` (live, from the auth handle, like
  `hasUsableOAuthProvider`, `server.ts:2530-2539`); when it returns true the tier is
  `null`: REST rejects the cookie (cleared; 401 for JSON, and for an HTML request the
  same 302 `/auth/login?return=<encoded url>` an unauthenticated HTML request gets,
  `auth-plugin.ts:594-596`; the login page then states the remedy, G12 — no new query
  contract or route; `auth-plugin.ts:581-600`), `/auth/status` reports unauthenticated, WS
  upgrades and live-capability liveness refuse it (`server.ts:2383`, `:4888`, `:4895`).
  Passkey (`PASSKEY_PROVIDER`) and bearer sessions never reach it. The accessor decides
  from the JWT's `provider` claim, the only provider information the token holds
  (`auth.ts:26-37`; no issuer claim). A token whose `provider` claim is missing, empty
  or not a string is rejected (G14, fail closed: only `tier` has a documented legacy
  default, and extending it to `provider` would let a forged-shape token bypass the rule;
  every issued token carries `provider`):
  - **(a) Decided from config, not the registry (H8).** `authState` keeps the
    configured `providers` map next to `providerRegistry` (both refreshed in
    `_reloadAuth`, `auth-plugin.ts:283-295`). A JWT whose `provider` key is **absent from
    the configured providers entirely** (provider removed from `auth.providers`, or
    dropped by config validation, `shared/src/config.ts:1932-1944`) is rejected whatever
    its key (fail closed; the token records no issuer). A key still configured is
    classified by `classifyProviderConfig` — a provider whose OIDC discovery failed is
    classified exactly like a healthy one, so its sessions are rejected only when it is
    public AND in open enrolment, and survive a discovery outage otherwise. Consequence:
    **removing a provider from config revokes the sessions it issued** (a narrowing of
    CRED-03; the operator must expect it, see Migration). Alternative rejected: record an
    issuer/class claim in new tokens — a token-format change for a corner case, and every
    pre-upgrade token would still lack it.
  - **(b) WebSockets — sweep is mandatory (H2).** Extending `effectiveSessionTier`
    already follows the passkey revocation precedent (Context): the browser socket's
    `sessionTier` closure now yields `null`, and the socket closes with code 4401 on
    its next inbound frame (`ws-tier-gate.ts:11,33`, `browser-gateway.ts:2089-2091`).
    That is lazy, so an idle socket that only receives pushes would survive, and a
    terminal socket (shell I/O, the most sensitive road) is never re-checked after the
    upgrade. `registerAuthPlugin` therefore takes an optional `onAuthReloaded` callback
    invoked at the end of `_reloadAuth` (`auth-plugin.ts:283-295`); `server.ts` passes a
    late-bound closure (the gateways are built after the auth plugin, `server.ts:2530`)
    that sweeps `browserGateway.wss.clients` (`browser-gateway.ts:2633`) and
    `terminalGateway.wss.clients` (`terminal/terminal-gateway.ts:14`, `:40`) and closes
    every socket whose `sessionTier?.()` is `null` with `WS_CLOSE_SESSION_REVOKED`.
    **Sweep contract (G7-G10).** The sweep is synchronous at the end of `_reloadAuth`:
    when `await reload()` resolves, every target socket has had `close(4401)` issued
    (CLOSING), with no inbound frame needed and no wall-clock bound. It runs whatever
    providers remain, including a reload that removes the last provider and leaves auth
    inactive (G8: the limiting instance of "removes"; fail closed). `authState` is
    swapped before the callback runs (`auth-plugin.ts:283-295`), so a throwing sweep is
    caught and logged at error level and the reload stays applied, no rollback (G9;
    the error-level line is the signal that revoked sockets may still be open). When
    N > 0 sockets are closed, exactly one aggregate line is logged carrying N and the
    per-gateway counts, no provider or user identity; N = 0 logs nothing (G10).
    **The terminal stamp is not optional:** `TerminalGateway.handleUpgrade`
    (`terminal-gateway.ts:23-34` interface, `:48-54` implementation) gains an optional
    `sessionTier?: () => Tier | null` parameter after `principalExpiresAt`, assigned on
    the socket inside the `wss.handleUpgrade` callback (`:68-73`; `TieredSocket`
    `ws-tier-gate.ts:20-22`), and the `case "terminal"` call site (`server.ts:5005-5019`)
    passes `sessionTierOf`, the same value the browser case stamps at `:4983`. There is
    no fallback that drops the terminal sweep.
  - **(c) Live-preview sockets are not swept (H3).** `case "live"`
    (`server.ts:5022-5035`, `handleLiveServerUpgrade` `:5029`) proxies a dev-server
    socket under a capability URL (`liveCap.prefix` `:5032`), not a session-tier road:
    it carries no `sessionTier`, so neither the lazy gate nor the sweep sees it. New
    upgrades by a refused provider's cookie are refused at the door (`isSessionLive`,
    `:4888`; road tier `LIVE_PREVIEW_TIER` `:4896-4903`); an already-open socket ends at
    its ticket's expiry (`scheduleAtExpiry`, `:5027`). Recorded as a residual (register
    row, owner none).
  **Residual:** editing an allowlist later does not revoke already-issued tokens of
  still-allowed open providers (CRED-03, out of scope); neither does tightening.
- Warning: one line per open-enrolment provider at register (`:262`) and in
  `_reloadAuth` (`:292`), format like the redirect-base line.
- Posture (F11): the plugin decorates the fastify instance with a getter
  (like `_reloadAuth`) that computes `openEnrolmentOf` from the **live `authState`**;
  `GET /api/auth/diagnostics` (`routes/system-routes.ts:799-816`) returns
  `openEnrolment: [{provider, mode}]` from that getter, **not** from
  `loadConfig()` (`:803`); empty array when auth is inactive. `SettingsPanel.tsx`
  Security tab fetches it on mount and after a successful save and renders a banner
  above the provider list (`:2516`). Server-derived so the client needs no
  `groupTiers`. **Who sees it (H10):** the banner is rendered for callers who can read
  `GET /api/auth/diagnostics` — tier `operate` (`shared/src/route-tiers.ts:113`), the same
  tier as `GET /api/config` and the Settings Security tab itself. Security settings are
  operator-facing, so no tier change is made; a lower-tier caller's fetch is refused and
  renders no banner (and no error).
- `groupTiers` alone lifts the refusal (operator intent: groups bound the tier). Note
  that github/google carry no `groups`, so a `groupTiers`-only config already refuses
  everyone via `resolveGroupTier` (`auth.ts:247`); unchanged. `groupTiers` is a
  config-file-only key (H9): `parseGroupTiers` (`shared/src/config.ts:1887-1894`) keeps
  valid group→tier entries and treats a map with none as unset; the Settings save path
  preserves the stored value (`config-api.ts:267` spreads `existingAuth`; only
  `allowedUsers` is merged from the partial, `:288-290`) and the client `AuthConfig`
  (`SettingsPanel.tsx:137-148`) does not model it. The `shared-config` delta therefore
  documents an `auth.groupTiers` row, including that a non-empty map lifts the
  open-enrolment refusal.
- `keycloak-resolver-plugin` (bearer resolver) and passkeys are untouched.

**Alternatives considered.**
- *Key-based classification only (`github`/`google`)* (first draft): an `oidc` or
  arbitrarily named key with `issuerUrl: https://accounts.google.com` would stay
  open (`auth.ts:110`); replaced by issuer/host classification. A first revision of that
  fix also consulted discovered endpoints; dropped (H8) because discovery can fail,
  and a discovery-failed provider must still be classified.
- *Fail-closed for all providers* (user-rejected): `keycloak`/`oidc` issuers are an
  operator-chosen tenant, so allow-all is an intentional single-tenant setup.
- *Warn only* (user-rejected): leaves the High finding open.
- *Config escape hatch* (e.g. `auth.allowAnyAccount: true`): an opt-in to the
  vulnerable state; rejected by default and not added (no flag, no rollback switch).
  Operators who really want everyone from a public IdP can add `*@gmail.com`-style
  wildcards — deliberate and visible.
- *Observe-cap* (user-rejected; open-enrolment sessions capped at `observe`): still
  admits arbitrary accounts to session transcripts.

**Trade-offs.** Breaking for public-IdP deployments without an allowlist (see
Migration). `*@domain` wildcards still permit a whole domain by design. A fixed host
set misses public IdPs not in it (e.g. self-hosted GitLab): those stay allow-all +
warning and the set grows by one line.

## Risks / Trade-offs

- **D1 false refusal:** the file set is fixed; a user relying on the editor for
  `models.json`/`mcp.json` loses it (mitigated by Settings pages; CHANGELOG notes it).
- **D1 predicate cost:** one `readdir` per agent dir per open in
  `alwaysRefusedFiles` (already walks `local/`) and one cached volume probe; the grep
  identity filter adds one `stat` per distinct matched file (≤ 500 matches,
  `lib/grep.ts:82`). Cache by (dir mtime) only if profiling shows need; not assumed.
- **D1 residuals:** converter-path swap window (`rendered-pdf`), `settings.json` legacy
  keys, session-side `PI_CODING_AGENT_DIR` override, project-layer `.pi/mcp.json`,
  `~/.pi/agent/backups/**`, the `/api/pi-resource-file` substring allowlist, the JS grep
  walker reading a hard-linked file before gate 2 drops its matches, plugin routes
  added after the audit (task 1.13 keeps the table current), live-preview sockets on an
  auth reload (D3(c)).
- **D2 loss of a broken tool:** none functional. The residual REST answer road and
  the three other broken `session`-bind rows are recorded, not closed.
- **D3 lockout:** after upgrade, a remote operator with only a public IdP and no
  allowlist is locked out until they edit `config.json` (or Settings via loopback);
  existing sessions of those providers are rejected on next request and their open
  browser and terminal sockets are closed at the next reload sweep (live-preview
  sockets are not, D3(c)). Removing a provider from config revokes the sessions it
  issued (fail closed, D3(a)); a discovery outage alone does not. Passkeys and trusted-host bypass
  remain; the remedy page names the fix.
- **D1 Windows alternate names (G5, residual, no test):** NTFS alternate data
  streams (`auth.json::$DATA`), 8.3 short names (`AUTHJS~1.JSON`) and trailing-dot names
  may reach a credential file by a name that is not the listed name. Content sites are
  covered by the post-open `(dev,ino)` recheck; path-level sites (mention resolver,
  `tree`) may under-refuse. Not normalised in the predicate (new requirement) and not
  covered by a Windows smoke row; recorded in the proposal residual table.
- **Doc drift:** `docs/security/*` cites old behaviour; updated via DocScribe.

## Migration / Rollback / Compatibility

- **Data:** none. No migration of config or stored state.
- **D1:** behavioural only; no flag. Rollback = revert the change. Existing
  `requireLocalProof:false` does not reopen it (same recorded exception as the
  state-dir tier). Compatible with `encrypt-credentials-at-rest`: encrypted
  `plugin-credentials.json` stays refused. Editor-pane / file-route access to
  `models.json`, `mcp.json` and the other credential files is lost (BREAKING, see
  proposal).
- **D2:** `prompt_response` and `extension_ui_response` disappear from `tools/list` and
  `tools/call` returns the standard unknown-tool error, for session and device
  tokens alike. No client loses a working capability (the tools never answered a
  prompt). Dashboard UI and chat-gateway answers are unchanged (chat tier moves to
  the chat-local table, same `control`). Rollback = revert + rerun codegen; no
  persisted state, no new route. Version skew: see D2 trade-offs.
- **D3:** BREAKING for public-IdP + empty allowlist; also, removing a provider from
  `auth.providers` now revokes the sessions it issued (a JWT of an unconfigured provider
  is rejected). Rollback/mitigation =
  set `auth.allowedUsers` (or `auth.groupTiers`) and the live reload applies without
  restart; reverting the change restores allow-all. No escape-hatch flag (decided).
  CHANGELOG `Unreleased → Security` with a BREAKING line, README auth table updated
  (`README.md:366` "Empty = allow all" becomes provider-specific), remedy page and
  startup warning point at the fix.
- **G2 — open-enrolment state created before the upgrade (named residual).** While
  a public provider was open, a stranger could sign in at `operate` and then create
  passkey users, mint passkey invites and pair devices (device bearers outlive their
  OAuth session). The upgrade rejects the OAuth session but cannot tell which users,
  invites or devices it created. **Operator remedy:** after upgrading, review
  Settings ▸ Users and Settings ▸ Paired devices and revoke anything unrecognised.
  The startup warning for a refused provider (D3) names this review; the CHANGELOG
  BREAKING entry repeats it. Owner: none (residual).
- **Sequencing:** no spec collision found with in-flight changes. Closest:
  `close-loopback-legacy-window` MODIFIES a different requirement of
  `trust-and-credential-boundaries` ("Opt-in local proof for loopback trust");
  `add-plugin-capability-routes` MODIFIES a different `oauth-authentication`
  requirement ("Localhost and trusted host bypass"); `add-spawn-model-choice` ADDS an
  unrelated `dashboard-mcp-server` requirement; `add-supervised-tool-approval` ADDS to
  `chat-gateway`, not `chat-gateway-tier-authorization`. No in-flight change touches
  `file-read-containment`, `shared-config`, `mcp-tool-tiers`, `path-anchor-grants` or
  `chat-gateway-tier-authorization`. `add-supervised-tool-approval` is recorded as
  `related` only: it is where the residual REST answer road is addressed.
