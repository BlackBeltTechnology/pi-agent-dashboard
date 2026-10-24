# Design

## Context

See proposal.md (Why) for motivation and spike evidence. Current state relevant to the approach:

- **Frame host.** `CraftFrameHost` / `frame-session.ts` own one sandboxed iframe per editor instance:
  - `sandbox="allow-scripts"`, opaque origin;
  - a per-mount nonce in the URL fragment (`packages/craft-web-plugin/src/client/CraftFrame.tsx:165-167`; read in-frame at `src/shim/craft-shim.js:118-119`).
- **Shim protocol.** The shim (`craft-shim.js` v2) speaks a fixed lifecycle protocol: `ready/opened/dirty/save/blocked/csp/navigate-blocked/start-failed` up, `open/save-result` down (`docs/craft-web-plugin.md` §6).
- **Unsaved state.** Dirty is derived from trusted user input plus title markers only (`craft-shim.js:377-381,424-429`). VectorCraft's title profile has no dirty marker (`src/shared/app-profiles.ts:216`).
- **Save routing.** User saves go through `routeSave` (`src/client/save-routing.ts`). VectorCraft is type B: Save writes `.vectorcraft` → sibling dialog (create / create-and-open / download / cancel), never an overwrite of the tab's `.svg` (`docs/craft-web-plugin.md` §8). In-place apps go through the save-target toggle, the first-overwrite notice and core conflict handling.
- **Shim compatibility.** Profiles set `minShimVersion` 1 (WordCraft, `app-profiles.ts:125`) or 2 (`app-profiles.ts:221`). An older supported shim stays usable with `shimUpdate:true` (`src/server/service.ts:248-256`). The client status parser exposes `shimUpdate` but not `shimVersion` (`src/client/status-types.ts:51-59`).
- **Frame profile.** The shim sees only `window.__CRAFT_PROFILE__ = frameProfile(p)`; its hash keys the prepared tree (`app-profiles.ts:282-290`, `post-install.ts:54-58`).
- **Craft control protocol.** It is compiled into every Craft wasm build. VectorCraft ≥ 0.14 exposes it in-page as `window.vectorcraft.request(method, params) → Promise`, plus convenience wrappers; `screenshot` is `request("ui.screenshot")` (upstream `apps/vectorcraft-web/src/api.rs`). Requests run on the app's UI loop. A queued request cannot be cancelled from the page.
- **Page APIs upstream (checked 2026-10-24).** `window.vectorcraft` (VectorCraft ≥ 0.14), `window.filmcraft` (FilmCraft ≥ 0.5, installed from wasm) and `window.effectcraft` (EffectCraft ≥ 0.8, wrapped by the app's `web/index.html`; EffectCraft needs `?nosw` and its worker trampoline). The other ten apps have no web transport. Their wasm contains the protocol, but nothing feeds `control_rx`. GridCraft and CADCraft have a `?host=parent` bridge for open/save/dirty only, and it works only for same-origin parents.
- **Plugin seams.**
  - Bridge → server request lane `requestPluginServer` / `registerPiRequestHandler`: sessionId from the socket key, 256 KiB caps, 15 s (`docs/plugin-seams.md` "Request/reply lane").
  - Browser → server `registerBrowserHandler(type, (msg, ws))` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:156`). Plugin-registered message types are unlisted, so they need tier `operate`, fail-closed (`packages/shared/src/ws-message-tiers.ts:14`); an observe-only socket cannot send them.
  - `broadcastToSubscribers`: a frame with `sessionId` is owner-scoped when identity is enforced; otherwise it fans out to every browser, which in single-user mode all belong to the one operator. Without a `sessionId` it is always global (`packages/server/src/server.ts:4066-4074`, `packages/server/src/pairing/browser-gateway.ts:1557-1566`).

## Goals / Non-Goals

**Goals:**
- One agent request runs in at most one live, visible editor instance, and the result comes back bounded in time.
- Agent edits are never silently lost: they mark the tab unsaved, and agent saves meet exactly the dialogs a user save meets.
- The shim stays a relay. Policy lives on the host and the server, where it can be tested.

**Non-Goals:**
- Headless fallback inside `craft_control`; the agent uses `pi-craft` explicitly.
- Opening a workspace file in the pane for the agent.
- Collaborative-editing semantics (OT, caret rebasing, separate undo stacks): upstream, documented in the skill.
- Subscriptions or change streams. Request/reply only.
- Any control transport other than `page-api`. We ask upstream for a page API (three apps already ship one). If an app ships a different transport instead, a follow-up adds a profile kind for it.
- Cancelling a request inside the app after a timeout. Not possible through the page API.

## Decisions

### D1. Path: probe → claim → run, all session-scoped broadcasts

```mermaid
sequenceDiagram
  participant T as craft_control tool (bridge)
  participant S as craft-web server
  participant C as browser clients (session S)
  participant H as CraftFrameHost instance
  participant F as shim + app (iframe)
  T->>S: requestPluginServer("craft-web","craft-web/control",{path,method,params,instance?})
  S->>S: resolve path (session cwd, realpath); reqId = CSPRNG uuid
  S->>C: broadcast {type:"craft-web/control-probe", sessionId:S, reqId, path, realPath, relPath, caseInsensitive}
  C-->>S: craft-web/control-claim {reqId, instanceId, status, msSinceFocus}
  Note over S: remember the claiming ws per instanceId; 800 ms window; choose (D2)
  S->>C: broadcast {type:"craft-web/control-run", sessionId:S, reqId, instanceId, method, params, ttlMs}
  C->>H: only the client holding instanceId acts; it revalidates opened + visible + path, and drops the run once ttlMs (from receipt) has passed
  H->>F: control {nonce, id, method, params}
  F-->>H: control-result {nonce, id, ok, result|error}
  H-->>S: craft-web/control-result {reqId, instanceId, ok, result|error}
  Note over S: accept only from the ws that claimed instanceId, and only once
  S-->>T: envelope (D4)
```

Probe and run:
- Probe, claim, run and result all use existing seams: session-scoped `broadcastToSubscribers` and `registerBrowserHandler`. The server never sends on a retained raw socket.
- Claims and results are plugin message types, so they need tier `operate` (fail-closed). A device without operating rights can neither claim nor answer.

Acceptance:
- A result is accepted only from the same `ws` object that sent the winning claim, for that `reqId`, once.
- A socket that closes before the run broadcast leaves no eligible claim → `not-open`. After the run broadcast, any missing result means `timeout` (outcome unknown), never `not-open`, because the command may have run. Cleanup is the server's 13 s TTL; no disconnect hook is needed.

Run-time recheck: before forwarding a run to its frame, the host re-checks that the instance is still opened, visible and on the same path, and that `ttlMs`, measured from when the client received the run, has not passed. No cross-device clocks are compared. Otherwise it answers with the matching status (`not-visible`, `not-ready`, `not-open`) without forwarding.

Exactly-once:
- `reqId` is a CSPRNG uuid.
- `instanceId` is a per-instance uuid that only its client knows until the run broadcast reveals it. A run is acted on only by the client that registered that `instanceId`, so exactly one instance executes.

Pinned follow-ups: every reply carries an opaque `instance` handle (`instanceId`). A request that passes `instance` skips the probe and runs the same eligibility checks on that instance only, except for `host.state` (D5). If the handle is gone → `not-open`.

Alternatives rejected:
- **Broadcast run, first reply wins:** it mutates every open copy.
- **Retaining the claiming `ws` and sending on it later:** that bypasses the gateway's scoping, and the plugin context types `ws` as `unknown`.
- **A new core targeted-send seam:** not needed.

### D2. Claims, eligibility and choice

Path matching:
- The server resolves the request path against the session cwd and sends three NFC-normalised forms:
  - lexical absolute (`path`);
  - `realPath`, when the file exists;
  - `relPath`, relative to the session cwd, when the path lies under it.
- It also sends `caseInsensitive` (true on darwin/win32).
- A client claims an instance when its tab path matches any of the forms:
  - the absolute tab path (`props.cwd` + tab path, lexically normalised) equals `path` or `realPath`;
  - or the tab path relative to `props.cwd` equals `relPath`.
  - Comparison is case-folded when `caseInsensitive`.
  - This covers a symlinked cwd whichever form the agent or the tab used.

Each client claims every instance whose path matches, with `status` set to the first of these that applies:
1. `wrong-session`: the instance's own `sessionId` ≠ S (keep-alive instances keep their session).
2. `unsupported`:
   - the profile has no `control`;
   - or the installed build version ≠ `control.verifiedVersion`;
   - or the build's `shimVersion` < 3.
3. `not-ready`: not `opened` yet.
4. `not-visible`: the pane tab is not active or the page is hidden. Hidden frames are throttled, and the user can't see the agent edit.
5. `eligible`.

Choice:
- The window closes 300 ms after the first eligible claim, or after 2 s when none arrives. This is best-effort: a device slower than 2 s is not considered, and a repeat request will see it.
- One eligible claim → run it.
- Several → the smallest `msSinceFocus`, an age measured on each client so no cross-device clocks are compared, if ≤ 10 min. Ties go to the earliest claim. Beyond 10 min → `ambiguous`.
- No eligible claim → the most specific status seen, in the order `not-visible` > `not-ready` > `unsupported`.
- Nothing, or only `wrong-session` → `not-open`. The message says the file must be open and visible on a device with full operating rights, because devices with lesser rights cannot claim.

Trust: claims are self-reports by operate-tier sockets of the session's principal. A misbehaving client of the same principal can mis-route its own user's request. This is accepted and documented in Risks.

### D3. Shim v3 relay, `page-api` transport only

New messages, nonce-bound:
- host → frame `control {nonce, id, method, params}`;
- frame → host `control-result {nonce, id, ok, result?, error?}`.

The frame profile gains only `control: { kind: "page-api", global: "<name>" }`. This changes the enabled app's profile hash, so its tree is re-prepared, which its `webVersion` bump (or, for W2, its new claim) forces anyway. The policy lists (D4) stay host-side so that editing them never forces a re-prepare.

The shim calls `window[global].request(method, params)` and settles on resolve or reject:
- before `opened` → `not-ready`;
- global absent after opened (bounded 2 s wait) → `unsupported`, naming the expected version and "Settings → Update".

Host side:
- one request in flight per instance (`busy`);
- 10 s app timeout. A timeout means **outcome unknown**, because the app may still run the request.
- After a timeout the instance stays `busy` until the late result arrives or 30 s pass, so a second request never queues behind a stuck one inside the app.

Versioning:
- `SHIM_VERSION` 2 → 3.
- Every profile keeps its current `minShimVersion`, so offline users keep their older trees.
- Shim v3 announces itself: `ready` gains `shimVersion` and `control: true|false`. The host decides `unsupported` from the running frame's own announcement, which also covers a frame loaded before a `current` swap, not from the prepared build's status. The announced capabilities are stored per frame load and reset on every `ready`, reload or navigation drop.
- Shim v3 also adds `msSinceInput` to every `save` message: milliseconds since the last trusted user input in the frame, from the existing input tracking (`craft-shim.js` `markInput`).

Time budget, against the lane's 15 s: probe window ≤ 2 s + app 10 s + screenshot processing ≤ 1 s + transport margin, with a hard server TTL of 13 s. Every timeout, at whatever hop, is reported as `timeout` with outcome unknown.

### D4. Policy, caps and the reply envelope

The security boundary is unchanged: frame isolation, CSP, and the save path with its authz, conflict and validator checks. The method policy is a correctness and usability layer, and it fails closed:

- **Top-level allowlist** (host): `engine.execute`, `engine.commands`, `document.inspect`, `ui.inspect`, `ui.screenshot`, plus the host-implemented `host.state` (D5).
- **Nested-command allowlist per app**, for `engine.execute`. Params must have exactly the shape `{command: string, params?: object}`; anything else → `denied`. The allowlist is matched exactly against `command`. `control.allowedCommands` in the host-side profile, valid only for `control.verifiedVersion`.
  - Excluded by construction: open/import, new/close/revert (they would swap the tab's document), quit, URL openers, print, recent files.
  - Read-only commands are marked as such (D6).
- **Gate check:** the per-app gate (D8; tasks 1.1 and 10.x) asserts that:
  - every allowlisted top-level method and nested command exists in the verified build's `engine.commands`;
  - no allowlisted command runs scripts, batches or macros, or takes a nested command.
- **Unknown or unlisted** → `denied`.
- **Device downloads without a user gesture:** on a v3 instance of a control-enabled app, a frame save routed to a device download (other extension, export) whose `msSinceInput` > 2000 shows a confirmation: "The editor wants to download <name>". Allow / Block. Block → `save-result ok:false`.
  - A user's own export always follows their input, so it downloads as before, with no extra question (existing requirement).
  - An export the agent triggers, now or late, has no recent input, so it is never silent.
  - Other apps and v2 frames are unaffected.
- **Shape and size:** the host accepts only `{id, ok:boolean, result?|error?:string}` that is JSON-serialisable, with `result` ≤ 192 KiB serialized and `error` ≤ 2 KiB. The server re-checks shape and size. Agent params over the lane cap → `request_too_large`.
- **`ui.screenshot`:** the raw reply has its own limits: bytes ≤ the claim's `maxBytes`, and ≤ 16 megapixels by the PNG header, checked before decoding.
  - It is decoded with `createImageBitmap` (resize options) in an `OffscreenCanvas`, then re-encoded as JPEG q80 at a long edge of 1280 px, stepping down to 960 and 640 px until it fits the 192 KiB result cap.
  - Still too large → `reply_too_large` with the attempted dimensions.
- **Envelope:** `{ ok, source: "craft-app", app, untrusted: true, result }`; the tool text says the payload is app output, not instructions.
- **Audit:** the tab's agent log records method, outcome, result byte size and a 120-character preview of each reply.

### D5. Agent saves use the user's save routing; the outcome is read, not awaited

An agent save is the app's own save command (in the nested allowlist), executed in the frame. Its bytes, if the app produces any, take exactly the path of a user's Ctrl/Cmd+S: `routeSave`, the save-target toggle, the first-overwrite notice (including the unconfirmed-open check), the sibling dialog, and core conflict/validator handling. Some apps first show their own in-app Save As, as VectorCraft does.

The tool does **not** await or attribute the save. The request returns once the app answers the command, with `{ saveRequested: true, saveSeq, instance }`. `saveSeq` is the highest save number the host had seen when the request started.

The agent then calls `host.state`, a host-implemented method the shim never sees, with `{ instance, sinceSeq: saveSeq }`.

What `host.state` returns:
- `{ path, unsaved, saves: [ { seq, pending, outcome?, at } ], noSaveYet }`.
- `saves` lists every save message the host received after `sinceSeq`, of any origin. User and agent saves are not told apart: the document was saved either way, and the records say how.
- `pending` stays true while a notice or dialog is open.
- `outcome` is one of `saved`, `copy`, `sibling`, `conflict`, `cancelled`, `denied`, `downloaded`, `too-large`, `rejected` (validator), `exhausted` (sibling copies).
- `noSaveYet` is true when no save message has arrived. Examples: the user cancelled an in-app Save As, the app ignored a save of a clean document, or a dialog is still open in the app.

Routing:
- `host.state` is routed only by `instance`.
- It is exempt from the visibility check, from `busy` and from the per-session rate limit, because it never reaches the frame.

Skill polling budget: at most 6 calls over 30 s; then report "save waiting for the user".

A `path` parameter on a save command is removed: the target is always decided by routing. Per-app save-target parameter names live in the host-side profile.

### D6. Unsaved state under agent edits

- The instance gets an `agentPending` flag. It is set when a non-read-only request is **forwarded** to the frame, whatever its result: `ok`, `app_error` after partial work, timeout, or a late or missing result.
- The reported unsaved state is `shimDirty || copyPending || agentPending`. The shim's own `dirty:false` (for example a VectorCraft title change with no input) cannot clear it.
- `agentPending` clears only when an own-file save is acknowledged **and** no non-read-only agent request succeeded after that save message arrived. Save bytes are captured when the save message is sent, while dialogs can stay open for minutes. A copy, sibling or download save never clears it, because the tab's file still lacks the edits.
- An app whose saves never overwrite the tab's file (VectorCraft saves to a sibling unless the gate proves an own-format save) keeps `agentPending` until the user discards: "Reload from disk" or closing with discard (existing guards). The skill tells the agent to prefer `pi-craft` headless for bulk edits on such apps, and to tell the user the tab stays unsaved.
- Existing guards (close, mode switch, reload, keep-alive eviction) therefore apply to agent edits.

### D7. Tool surface and errors

`craft_control({ path, method, params? })`. The path is resolved against the session cwd by the server.

Errors:
- routing: `not-open`, `ambiguous`, `not-visible`, `not-ready`, `unsupported` (with an update hint);
- policy and limits: `busy`, `timeout` (outcome unknown), `denied`, `reply_too_large`, `request_too_large`, `rate_limited` (20 / 10 s per session, server);
- app: `app_error` (app message, ≤ 2 KiB);
- availability: `unavailable` / `no_handler` (plugin disabled or server without it; sessions already running keep the tool until restart), `disabled` (config kill switch `plugins['craft-web'].liveControl: false`).

### D8. One enablement gate per app; VectorCraft blocks the change

An app gets a `control` entry only after its web build, at the version being pinned, passes the gate:
- the existing per-app e2e rows;
- the control rows, under the production sandbox and after the real post-install (for EffectCraft: `window.effectcraft` survives the post-install `index.html` rewrite and `?nosw`);
- `allowedCommands` and the read-only marks derived from, and checked against, its `engine.commands`;
- each read-only command leaves the document unchanged (a `document.inspect` digest before and after is equal);
- the app's own-file save path through the app. Where it has none, D6's "never clears" path is the documented behaviour.

A `control` entry is valid only for an app that has an edit claim in the pane (profile check), so it cannot be added ahead of its claim.

| Wave | Apps | Prerequisite | If absent at ship time |
|---|---|---|---|
| W1 | VectorCraft | web ≥ 0.14 (pin bump from 0.13.1) | Implementation stops (`SHIP_IT_BLOCKED.md`). No machinery ships without an enabled app. |
| W2 | FilmCraft, EffectCraft | `add-craft-web-media-projects` has shipped the `.fcproj` / `.ecproj` claim; the page API already exists | Recorded as pending |
| W3 | GridCraft, WordCraft, PhotoCraft, LightCraft, PdfCraft, DesignCraft, SoundCraft, DeckCraft, CADCraft | An upstream release with `window.<app>.request` | Recorded as pending with the issue URL |
| W3 | FigCraft | The above, plus an editor-pane claim (separate change) | Recorded as pending |

"Recorded as pending" is a row in the live-control status table (`docs/craft-web-plugin.md`): app, state, prerequisite, issue URL. A gate task is done either way, so upstream timing never blocks this change. A later enablement is a follow-up change that runs the same gate.

The fakecraft test double is served only when `PI_DASHBOARD_FIXTURE_PLUGINS=1`, through an explicit env check in craft-web; the fixture gate itself only covers `fixture: true` plugins (`docs/plugin-seams.md` "Fixture gate"). A test proves that it is absent by default.

### D9. Skill ships with the plugin

The skill `craft-live-edit` lives in `packages/craft-web-plugin/.pi/skills/`, next to the tool it documents. `.pi/` is added to the package `files`, as `packages/obs-studio-plugin/package.json` does. Installing the package loads the skill even when the plugin is disabled, so the skill opens with: "if `craft_control` is unavailable, use `pi-craft`". `craft-studio` links to it.

## Risks / Trade-offs

- **Shared undo history** (spike: the agent's undo removed user typing) → skill rule: `edit.undo` only when asked and when `document.inspect` shows the agent's step on top. Not enforced, because the user may ask for an undo.
- **Caret not rebased** (WordCraft, W3) → skill rule + upstream ask.
- **Toggle commands** → skill: read state first.
- **Late completion after timeout** → "outcome unknown" semantics; dirty still marked; skill: inspect before retrying.
- **The nonce is readable in-frame** (existing residual, `docs/craft-web-plugin.md` §6/§12). A malicious bundle can forge `control-result` content. Accepted: the reply is app output with the same trust as the app; it is enveloped as untrusted and size-capped. Writes still pass the save path.
- **Session scoping is a correctness guard, not authentication.** The request lane does not authenticate the caller (`docs/plugin-seams.md` "Trust boundary"), so any extension running in session S can drive S's open documents, like any tool.
- **Self-reported claims** (D2) and **owner scoping only under identity enforcement** (single-user mode = one operator) → mis-routing stays within one principal's own browsers; `reqId` is unguessable.
- **Path aliases** beyond the three forms (D2), e.g. a hard link → `not-open`; the skill tells the agent to use the path shown in the tab.
- **Keep-alive pinning:** each agent-edited, unsaved instance cannot be evicted (existing rule). A multi-file agent sweep can pin all three live slots. The skill says: prefer `pi-craft` headless for multi-file work, and tell the user which tabs hold unsaved agent edits.
- **Fail-closed policy may block a useful command** → per-app lists are edited in the profile, with an e2e row per addition.
- **Upstream transport never lands for W3 apps** → they stay pending; the feature covers W1 (and W2 once media projects land). The cost of keeping the machinery is small.
- **W2 depends on another change** → if `add-craft-web-media-projects` records a no-go, FilmCraft and EffectCraft stay pending although their APIs exist; their media-project caveats (OPFS recovery fails in the sandbox) are that change's concern.
- **Shim v3** changes the profile hash of each newly enabled app → re-prepare, which its version bump (or, for W2, its new claim) forces anyway; other apps are untouched.

## Migration Plan

- Ships behind the plugin opt-in (`craft-web`, `defaultEnabled:false`) plus a config kill switch `plugins['craft-web'].liveControl` (default `true`). The kill switch is checked on the server and leaves the frame profile untouched.
- `SHIM_VERSION` 2 → 3 sets `shimUpdate:true` on every other app's tree, so Settings offers an update for each; they keep working without it.
- Each enabled app (VectorCraft at least): the `webVersion` bump and the profile-hash change → re-prepare (network) on update.
- Rollback:
  - flip `liveControl` off: immediate, no re-prepare;
  - or disable the plugin: the tool answers `unavailable` / `no_handler` until sessions restart.
  - Removing an app's `control` profile entry changes its profile hash and forces another re-prepare, so it is not the rollback path.
  - A plugin downgrade after re-preparing makes v3 trees outdated for every app; this is the existing "downgrade offline" residual.
