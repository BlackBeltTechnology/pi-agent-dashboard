# Tasks

Exemplars used below:
- shim: `packages/craft-web-plugin/src/shim/__tests__/craft-shim.test.ts`
- frame host: `packages/craft-web-plugin/src/client/__tests__/protocol.test.tsx`, `save.test.tsx`
- plugin message hooks: `packages/dashboard-plugin-runtime/src/__tests__/plugin-context.test.tsx`
- request handler: `packages/browser-plugin/src/server/__tests__/index-dedicated.test.ts`
- craft-web service: `packages/craft-web-plugin/src/server/__tests__/service.test.ts`
- bridge tool: `packages/browser-plugin/src/bridge/__tests__/bridge.test.ts`
- WS tiers: `packages/server/src/identity/__tests__/ws-message-tiers.test.ts`
- drift: `packages/craft-web-plugin/src/__tests__/manifest.test.ts`
- e2e: `tests/e2e/craft-web-editor.spec.ts` (craft frames), `tests/e2e/plugin-embedded-app.spec.ts` (fixture-flag harness)

## 1. Gate: VectorCraft re-spike and the fakecraft fixture

- [x] 1.1 Re-spike the VectorCraft web build at the newest release ≥ 0.14 using the `spike-craft-web-app-in-sandbox` procedure: production sandbox and CSP, real post-install with shim v3. Checks:
  - title regex;
  - drop-open, dirty and Save;
  - `window.vectorcraft.request("ui.inspect")` resolves;
  - list `engine.commands` and derive `allowedCommands` plus read-only marks (no open/import/new/close/revert/quit/print/URL/script/macro/batch command);
  - whether an own-file `.svg` save is reachable (format choice in Save As);
  - how an agent-triggered save and export reach the shim's save hook.

  Record go/no-go, the version and the findings in `docs/craft-web-plugin.md` §14 via DocScribe. **No-go → write `SHIP_IT_BLOCKED.md` and stop.** Verify: the spike note exists with the version, the derived lists and the save/export findings.
- [x] 1.2 Add the fakecraft fixture app: static `index.html` plus `window.fakecraft.request`, with an in-memory document, a text field, an export button and the methods `echo`, `sleep`, `oversize`, `malformed`, `save`, `export`, `saveDialog`. It mounts through `serveApp` and gets a fixture profile with `control`, registered only when `PI_DASHBOARD_FIXTURE_PLUGINS=1` (explicit env check in `src/server/index.ts`). Verify: a unit test loads it under the production CSP and `request("echo")` resolves.
- [x] 1.3 Test, fixture gate: without `PI_DASHBOARD_FIXTURE_PLUGINS`, no fakecraft mount, profile or claim exists; with `=1`, all three exist. Exemplar: `src/server/__tests__/mount.test.ts`. (test-plan #E21)

## 2. Profiles

- [x] 2.1 Add `control` to `CraftAppProfile` (`src/shared/app-profiles.ts`):
  - `{kind:"page-api"|"page-command", global, verifiedVersion, allowedCommands, readOnlyCommands, saveParamNames, digestCommand?}` (`digestCommand` required for `page-command`);
  - `frameProfile()` projects only `{kind, global}`;
  - profile rule checks: `global` matches `^[a-z][a-z0-9-]{1,31}$`, `readOnlyCommands ⊆ allowedCommands`, and `control` only on an app with an edit claim.

  Set the VectorCraft entry and bump `webVersion` in `packages/craft-apps/src/registry.ts` only when 1.1 is go. Verify: the `profileErrors` tests for valid and invalid entries pass.
- [x] 2.2 Test, profile drift (test-plan #E20). Exemplar: `src/__tests__/manifest.test.ts`. Assert:
  - every `control` profile has `verifiedVersion` equal to the registry `webVersion`;
  - `allowedCommands` is non-empty;
  - read-only marks are a subset of `allowedCommands`;
  - no allowlisted command matches `/open|import|new|close|revert|quit|print|url|script|macro|batch/i`;
  - `frameProfile` holds only `{kind, global}`.
- [x] 2.3 Test, control needs an edit claim (test-plan #E26). Exemplar: `src/__tests__/manifest.test.ts`. `profileErrors` accepts `control` on an app with an edit claim and reports "control requires an edit claim" for an app with no claim (FilmCraft before media projects, FigCraft) and for a view-only claim.
- [x] 2.4 Update the `src/shared/AGENTS.md` and `packages/craft-apps/src/AGENTS.md` rows. Verify: the rows name `control` and this change.

## 3. Shim v3

- [x] 3.1 Implement the shim v3 relay in `craft-shim.js` and bump `SHIM_VERSION` to 3:
  - `control` → `window[global].request`;
  - `control-result`;
  - `page-command` kind: `engine.execute` → `window[global].command(command, JSON.stringify(params ?? {}))`, reply text `JSON.parse`d (failure → `app_error`), other methods → `unsupported`;
  - `ready` adds `shimVersion` and `control`;
  - `save` adds `msSinceInput`, from `markInput`.

  Extend `shim-protocol.ts` and its parser. Update the shim-version and service shim-compat tests: other apps' v2 trees → `shimUpdate`; `minShimVersion` is unchanged. Verify: the existing shim and server tests pass.
- [x] 3.2 Test, relay states (test-plan #E17). Exemplar: `craft-shim.test.ts`. Set up shim v3 with profile `control:{kind:"page-api",global:"fakecraft"}`, then post `control`:
  - before `opened` → `not-ready`;
  - after `opened` → the `request` resolve/reject is relayed as `ok:true/false`;
  - wrong nonce → ignored;
  - wrong `event.source` → ignored;
  - global absent for 2 s → `unsupported`, naming the version and "Settings → Update";
  - profile without `control` → `unsupported`.
- [x] 3.3 Test, `page-command` relay (test-plan #E27). Exemplar: `craft-shim.test.ts`. With profile `control:{kind:"page-command",global:"lightcraft"}` and a stub `command`:
  - `engine.execute{command:"library.info",params:{a:1}}` calls `command("library.info","{\"a\":1}")`, and the resolved `"{\"n\":2}"` → `ok:true, result:{n:2}`;
  - `engine.execute{command:"x"}` calls `command("x","{}")`, and the resolved `"not json"` → `app_error`;
  - `ui.screenshot` → `unsupported` naming `page-command`, and `command` is not called.
- [x] 3.4 Test, announcements (test-plan #E18). Exemplar: `craft-shim.test.ts`. When the shim v3 frame loads, `ready` carries `shimVersion:3` and `control:true` (`false` without a profile entry), and every `save` carries a numeric `msSinceInput`.
- [x] 3.5 Update `craft-shim.js.AGENTS.md`, and the protocol tables in `docs/craft-web-plugin.md` §6 via DocScribe. Verify: both list `control`, `control-result`, `ready.shimVersion/control` and `save.msSinceInput`.

## 4. Client host: relay, policy, unsaved state, saves, visibility

- [x] 4.1 Implement in `frame-session.ts`:
  - `runControl`: allowlist and `{command, params?}` shape check, save `path` stripping, one in flight, 10 s timeout, `busy` until a late result or 30 s;
  - `agentPending` set on forward and OR-ed into the reported unsaved state, cleared only by an own-file ack with no agent edit after the save message;
  - save numbering (`seq`, `pending`, `outcome`);
  - `host.state`;
  - per-frame-load capabilities from `ready`;
  - reply shape and size checks;
  - the screenshot pipeline (header check, `createImageBitmap` in an `OffscreenCanvas`, JPEG q80 at 1280 → 960 → 640).

  Verify: the tests in 4.4–4.12 pass.
- [x] 4.2 Implement the download confirmation in the save routing: on v3 control-enabled instances, a device download with `msSinceInput > 2000` asks first (Allow / Block); Block → `save-result ok:false`. Verify: 4.11 passes.
- [x] 4.3 Implement the client control registry over `usePluginMessage` / `usePluginSend`:
  - per-instance registration (`instanceId`, own `sessionId`, `props.cwd` + path, profile `control`, frame state, active tab, `visibilityState`, `msSinceFocus`);
  - claims with a status for every path match;
  - the run is acted on only by the client holding the `instanceId`, with a recheck and a `ttlMs` measured from receipt.

  Add the `craft-agent-active` chip and the `craft-agent-log` (50 rows: method, outcome, bytes, 120-char preview) in `CraftFrame.tsx`, with i18n keys at EN/zh-CN/hu parity. Verify: the tests in 4.13–4.17 pass, and so does `i18n.test.ts`.
- [x] 4.4 Test, method policy (test-plan #E9). Exemplar: `protocol.test.tsx`.
  - Forwarded to the frame: `engine.execute{command:"object.rectangle"}` (allowlisted) and `ui.screenshot`.
  - `denied`, nothing posted to the frame: `{command:"file.open"}`; `{command:…, extra:1}`; `{command:["a","b"]}`; `app.quit`.
  - Answered by the host, never posted: `host.state`.
- [x] 4.5 Test, save path stripping (test-plan #E10). Exemplar: `save.test.tsx`. An allowlisted save command with `params.path="/etc/x.svg"` reaches the frame without `path`, and the reply has `saveRequested:true`, `saveSeq` and `instance`.
- [x] 4.6 Test, `agentPending` (test-plan #E11). Exemplar: `save.test.tsx`.
  - A clean instance becomes unsaved when a non-read-only request is forwarded, whether the result is `ok`, `app_error` or a timeout with no result.
  - A shim `dirty:false` does not clear it.
  - An own-file ack with an agent `ok` between the save message and the ack keeps it unsaved.
  - A later own-file save with no agent edit after it → clean.
- [x] 4.7 Test, read-only requests (test-plan #E12). Exemplar: `save.test.tsx`. `engine.execute` of a read-only-marked command, `document.inspect` and `host.state` leave the instance clean.
- [x] 4.8 Test, save records (test-plan #E13). Exemplar: `save.test.tsx`. With `saveSeq=4`, call `host.state{sinceSeq:4}` after each step:
  - save 5 with the sibling dialog open → `[{seq:5,pending:true}]`;
  - save 5 resolves → `[{5,false,"sibling"}]`;
  - save 6 conflict → two records;
  - no save → `saves:[]`, `noSaveYet:true`.
- [x] 4.9 Test, busy and late results (test-plan #E8). Exemplar: `protocol.test.tsx` with fake timers.
  - A second request while one is in flight → `busy`.
  - After the 10 s timeout the instance stays `busy` until the late result arrives at 12 s.
  - With no late result it stays `busy` until 40 s (the 30 s cap), then is idle.
- [x] 4.10 Test, reply size (test-plan #E6). Exemplar: `protocol.test.tsx`.
  - `result` serialized at 192 KiB − 1 and at 192 KiB → accepted; at 192 KiB + 1 → `reply_too_large`.
  - `error` at 2 KiB → passed through; at 2 KiB + 1 → truncated to 2 KiB, `app_error`.
- [x] 4.11 Test, download confirmation (test-plan #E14). Exemplar: `save.test.tsx`. On a v3 control-enabled instance, a device-download save with `msSinceInput` 1999 or 2000 → no prompt; 2001 → prompt. A v2 frame and an app without `control` never prompt.
- [x] 4.12 Test, screenshot pipeline (test-plan #E15). Exemplar: `protocol.test.tsx` (mock `createImageBitmap` / `OffscreenCanvas`).
  - 4001×4000 → refused before decode.
  - 4000×4000 and 2560×1600 → JPEG with a long edge ≤ 1280 and ≤ 192 KiB.
  - Noisy content that only fits at 640 → 640 px.
  - Still too large at 640 → `reply_too_large`, naming 640×400.
- [x] 4.13 Test, malformed replies (test-plan #X6). Exemplar: `protocol.test.tsx`. A frame `control-result` with `ok:"yes"`, a cyclic `result`, or an over-cap string → tool error, and the value is not relayed.
- [x] 4.14 Test, claim path matching (test-plan #E1). Exemplar: `plugin-context.test.tsx`. Probe with `path=/tmp/w/a.svg`, `realPath=/private/tmp/w/a.svg`, `relPath=a.svg`, `caseInsensitive=true`. Tabs `{cwd:/tmp/w, path:A.SVG}` and `{cwd:/private/tmp/w, path:a.svg}` claim as `eligible`; `b.svg` does not claim. With `caseInsensitive=false`, `A.SVG` does not claim.
- [x] 4.15 Test, claim statuses (test-plan #E2). Exemplar: `plugin-context.test.tsx`. One instance per condition, expected status:
  - own session ≠ S → `wrong-session`;
  - no `control` → `unsupported`;
  - frame `shimVersion` 2 → `unsupported`;
  - not opened → `not-ready`;
  - inactive tab → `not-visible`;
  - hidden page → `not-visible`;
  - all conditions met → `eligible`.

  When several conditions fail, the first rule in that order wins.
- [x] 4.16 Test, run TTL (test-plan #X5). Exemplar: `plugin-context.test.tsx` with fake timers. A run with `ttlMs=13000` held 13 001 ms before handling is dropped and nothing is posted to the frame.
- [x] 4.17 Test, agent log cap (test-plan #F2). Exemplar: `CraftWebSettings.test.tsx` render style. After 51 completed requests, the log shows 50 rows and the oldest is dropped.
- [x] 4.18 Update the `src/client/AGENTS.md` rows (new registry file, testids `craft-agent-active`, `craft-agent-log`, `host.state`). Verify: the rows exist.

## 5. Server routing

- [x] 5.1 Implement `src/server/control-router.ts`, wired in `src/server/index.ts` via `registerPiRequestHandler("craft-web/control")` and `registerBrowserHandler` for claim and result:
  - path resolution: lexical, realpath, relative, case flag;
  - CSPRNG `reqId`;
  - session-scoped probe and run broadcasts;
  - claim window: first eligible + 300 ms, else 2 s;
  - choice rules;
  - result accepted only from the claiming `ws` object, once;
  - 13 s TTL; rate limit 20 / 10 s with `host.state` exempt;
  - pinned `instance` routing;
  - kill switch `liveControl`;
  - server-side shape and size re-check.

  Verify: the tests in 5.3–5.10 pass.
- [x] 5.2 Add the telemetry line `telemetry <app> control outcome=<code> ms=<n>`, sharing the existing per-app rate limit. Verify: a `service.test.ts` case asserts the line for `ok` and for `denied`.
- [x] 5.3 Test, choice (test-plan #E3). Exemplar: `index-dedicated.test.ts`. Eligible claims and the expected choice:
  - `msSinceFocus` {60 000, 3 600 000} → the 60 000 claim;
  - {599 999, 600 001} → the 599 999 claim;
  - {600 001, 700 000} → `ambiguous`, no run broadcast;
  - tie {5 000, 5 000} arriving 20 ms apart → the earlier claim.
- [x] 5.4 Test, reason precedence (test-plan #E4). Exemplar: `index-dedicated.test.ts`. No eligible claim, by status set:
  - {`not-ready`} → `not-ready`;
  - {`unsupported`,`not-visible`} → `not-visible`;
  - {`wrong-session`} → `not-open`;
  - {} → `not-open`, with the "full operating rights" message.
- [x] 5.5 Test, claim window (test-plan #E5). Exemplar: `index-dedicated.test.ts` with fake timers. With a first eligible claim at 100 ms, a claim at 399 ms counts and one at 401 ms does not. With no eligible claim, the router answers at 2000 ms ± 10.
- [x] 5.6 Test, rate limit (test-plan #E7). Exemplar: `index-dedicated.test.ts`. A 21st routed request within 10 s → `rate_limited`; a 21st `host.state` → served.
- [x] 5.7 Test, pinned routing (test-plan #E16). Exemplar: `index-dedicated.test.ts`.
  - A request with an `instance` handle broadcasts no probe.
  - After the instance closes → `not-open`.
  - With the tab inactive: a mutation → `not-visible`, while `host.state` is still answered.
- [x] 5.8 Test, forged and late results (test-plan #X1, #X2). Exemplar: `index-dedicated.test.ts`.
  - A `control-result` with the right `reqId` and `instanceId` from a second socket is dropped and logged; the claiming socket's result is returned.
  - A result after the 13 s TTL is dropped, and the tool has already returned `timeout`.
- [x] 5.9 Test, socket loss (test-plan #X3, #X4). Exemplar: `index-dedicated.test.ts`. The claiming socket closes after the run broadcast → `timeout` (outcome unknown). The only claiming socket closes during the window → `not-open`.
- [x] 5.10 Test, kill switch (test-plan #E19). Exemplar: `service.test.ts`. With `plugins['craft-web'].liveControl=false`, a request → `disabled` and no probe broadcast.
- [x] 5.11 Test, tier gate (test-plan #X14). Exemplar: `packages/server/src/identity/__tests__/ws-message-tiers.test.ts`. `wsMessageTier("craft-web/control-claim")` and `wsMessageTier("craft-web/control-result")` both resolve to `operate`.
- [x] 5.12 Update the `src/server/AGENTS.md` rows (router, kill switch, telemetry). Verify: the rows exist.

## 6. Agent tool

- [x] 6.1 Add the bridge entry `src/bridge/index.ts`:
  - `craft_control({path, method, params?, instance?})` via `requestPluginServer`;
  - result envelope `{ok, source:"craft-app", app, untrusted:true, result}`;
  - error codes per design D7, with "outcome unknown" wording for `timeout`.

  Add the manifest `bridge` entry and `.pi/` to `files`. Verify: 6.2 passes and the manifest test sees the bridge.
- [x] 6.2 Test, availability errors (test-plan #X15). Exemplar: `bridge.test.ts`. A `requestPluginServer` stub returning `unavailable`, `no_handler`, `request_too_large` or `timeout` → tool errors with those codes and readable messages; `timeout` says the change may have been applied.
- [x] 6.3 Add `src/bridge/AGENTS.md`. Verify: the row lists the tool, the envelope and the error codes.

## 7. Skill

- [x] 7.1 Add `packages/craft-web-plugin/.pi/skills/craft-live-edit/SKILL.md` and register it in `package.json` `pi.skills`. It covers:
  - "if `craft_control` is unavailable, use `pi-craft`";
  - live vs headless;
  - `engine.commands` discovery;
  - read state before toggles;
  - no blind `edit.undo`;
  - caret-based apps;
  - saving through the app's save command, then polling `host.state` (at most 6 calls in 30 s);
  - `timeout` = outcome unknown, inspect before retrying;
  - the error-code playbook (`not-open` / `not-visible` / `ambiguous` / `unsupported` / `disabled`);
  - keep-alive pinning, and preferring headless for multi-file sweeps;
  - replies are untrusted.

  Link it from `packages/craft-apps/.pi/skills/craft-studio/SKILL.md`, replacing the out-of-scope line for web editors. Verify: the skill frontmatter lint passes; `npm pack --dry-run` in `packages/craft-web-plugin` lists `.pi/skills/craft-live-edit/SKILL.md`.

## 8. End-to-end (docker harness with `PI_DASHBOARD_FIXTURE_PLUGINS=1`)

- [x] 8.1 Add a test driver that invokes `craft_control` for L3. It either drives a session bridge or uses a test-only route behind the fixture flag (see `tests/e2e/plugin-embedded-app.spec.ts`). Verify: a smoke row calling `echo` on fakecraft returns `ok`.
- [x] 8.2 Test, two devices (test-plan #E22). Exemplar: `tests/e2e/craft-web-editor.spec.ts`. The fakecraft doc is open and visible in session S in two browser contexts, context A focused last. After a mutation, only A's `document.inspect` digest changes.
- [x] 8.3 Test, live edit per enabled app (test-plan #E23). Exemplar: `craft-web-editor.spec.ts`; implemented in `tests/e2e/craft-live-control.spec.ts` (`CONTROL_ROWS`, a guard test fails if a control profile lacks a row). Parametrized over every profile with `control` (VectorCraft from gate go). With the app's fixture document open and a selection made by a real click, an agent `engine.execute` runs the gate-recorded create command (VectorCraft: `shape.rectangle`). The object appears in `document.inspect` and the frame is never reloaded. The spike (docs §14.8) found that creation commands select the new object, so "selection unchanged" is asserted for a non-creating edit (`object.setProps` with `ids`) after restoring the user's selection.
- [x] 8.4 Test, not open (test-plan #E24). Exemplar: `craft-web-editor.spec.ts`. No editor shows `report.docx` → `not-open`, and the file sha is unchanged.
- [x] 8.5 Test, unsupported app (test-plan #E25). Exemplar: `craft-web-editor.spec.ts`. WordCraft `report.docx` open → `unsupported`, and no `control` message reaches the frame (frame message log).
- [x] 8.6 Test, routed latency (test-plan #P1). Exemplar: `craft-web-editor.spec.ts`. 50 sequential routed fakecraft `echo` requests, one context: round trip p95 ≤ 600 ms.
- [x] 8.7 Test, pinned latency (test-plan #P2). Exemplar: `craft-web-editor.spec.ts`. 50 sequential pinned (`instance`) `echo` requests: p95 ≤ 150 ms.
- [x] 8.8 Test, indicator and log (test-plan #F1). Exemplar: `craft-web-editor.spec.ts`. During a fakecraft `sleep 1500` request, `craft-agent-active` shows the method; after the reply it is gone, and `craft-agent-log` has one row with method, outcome, bytes and a preview of ≤ 120 chars.
- [x] 8.9 Test, user undo (test-plan #F3, gate go). Exemplar: `craft-web-editor.spec.ts`. In VectorCraft the agent adds a rectangle and the user makes no edit; a user Cmd/Ctrl+Z in the frame removes the rectangle.
- [x] 8.10 Test, user input during a request (test-plan #F4). Exemplar: `craft-web-editor.spec.ts`. While fakecraft `sleep 3000` is in flight, the user types into the text field. The text is present afterwards and the result is `ok`.
- [x] 8.11 Test, run-time recheck (test-plan #F5). Exemplar: `craft-web-editor.spec.ts`. The user switches the pane tab between probe and run. The frame receives no `control` message and the tool returns `not-visible`.
- [x] 8.12 Test, close guard (test-plan #F6). Exemplar: `craft-web-editor.spec.ts`. After an agent mutation `ok` on a clean fakecraft doc, closing the tab shows the discard confirmation.
- [x] 8.13 Test, timeout (test-plan #X7). Exemplar: `craft-web-editor.spec.ts`. Fakecraft `sleep 12000` → tool `timeout`, saying "may still have been applied", and the tab reports unsaved.
- [x] 8.14 Test, agent export (test-plan #X8). Exemplar: `craft-web-editor.spec.ts`. An agent runs fakecraft `export` after more than 2 s without user input. The confirmation is shown; Block → no Playwright download event; Allow → one download.
- [x] 8.15 Test, user export (test-plan #X9). Exemplar: `craft-web-editor.spec.ts`. The user clicks fakecraft's export button; the download happens with no confirmation.
- [x] 8.16 Test, conflict (test-plan #X10). Exemplar: `tests/e2e/editor-pane-file-handler.spec.ts` (conflict flow). After an external rewrite of the file, an agent save shows the conflict dialog, the file keeps the external bytes, and `host.state` lists `conflict`.
- [x] 8.17 Test, VectorCraft sibling save (test-plan #X11, gate go). Exemplar: `craft-web-editor.spec.ts`. After an agent save and the user's "Create", `logo.vectorcraft` exists, the `logo.svg` sha is unchanged, `host.state` lists `sibling`, and the tab is still unsaved.
- [x] 8.18 Test, cancelled in-app save (test-plan #X12). Exemplar: `craft-web-editor.spec.ts`. An agent save opens fakecraft's `saveDialog` and the user cancels: `host.state` → `noSaveYet:true`, `saves:[]`.
- [x] 8.19 Test, isolation (test-plan #X13). Exemplar: `craft-web-editor.spec.ts` F5 row. With control enabled, fakecraft `fetch("https://example.com")` and `fetch("/api/health")` are both refused, with CSP violations reported.
- [x] 8.20 Test, read-only commands per enabled app (test-plan #X16). Exemplar: `craft-web-editor.spec.ts`. Parametrized over every profile with `control`: for every read-only-marked command run via `craft_control`, the `document.inspect` digest is identical before and after.
- [x] 8.21 Manual check (test-plan: manual-only, #F7): `craft-agent-active` and `craft-agent-log` placement and legibility in dark and light themes next to the existing toolbar chips.
- [x] 8.22 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `npm run test:e2e -- craft-web-editor`. Verify: no failures in the log grep, and e2e is green.

## 9. Upstream

- [x] 9.1 Upstream ask. It already existed: photocraft#6450 (cross-app `window.<app>`), gridcraft#1274, wordcraft#1589, deckcraft#714. The user reviewed our evidence and approved it; it was posted as comments on 2026-10-24 instead of 10 duplicate issues:
  - https://github.com/storytold/photocraft/issues/6450#issuecomment-6383791154 (spike evidence, page-API shape, VectorCraft correction);
  - https://github.com/storytold/wordcraft/issues/1589#issuecomment-6383791347 (caret rebasing).

  The status table (10.1) cites #6450 for every W3 app, plus the per-repo issue where one exists.

## 10. Further apps (W2, W3)

Each gate task below ends in one of two recorded states, so none waits on upstream (LightCraft has no upstream prerequisite):
- **enabled**: run the D8 gate at the newest upstream release (re-spike under the production sandbox with the real post-install, derive `allowedCommands` and the read-only marks, record the create command for 8.3), bump `webVersion`, add the `control` entry. Rows 8.3 and 8.20 then cover the app.
- **pending**: the prerequisite is absent. Write the status-table row with the prerequisite and the upstream issue URL.

Verify for every gate task: the app's status-table row says `enabled <version>` (and 2.2, 8.3 and 8.20 pass with it) or `pending` (with the prerequisite and the URL).

- [x] 10.1 Add the live-control status table (all 13 apps: wave, state, prerequisite, page-API global, upstream issue) to `docs/craft-web-plugin.md` §14 via DocScribe. Verify: 13 rows; VectorCraft `enabled <version>` after 1.1.
- [x] 10.2 Gate FilmCraft (W2). Prerequisite: `add-craft-web-media-projects` has shipped the `.fcproj` edit claim. `window.filmcraft` exists upstream since 0.5. Check that the media-project mount (pushed media) leaves `window.filmcraft.request` working.
- [x] 10.3 Gate EffectCraft (W2). Prerequisite: `add-craft-web-media-projects` has shipped the `.ecproj` edit claim. `window.effectcraft` exists since 0.8 and is wrapped by the app's `web/index.html`. Check that it survives the post-install rewrite with `?nosw` and the worker trampoline.
- [x] 10.4 Gate GridCraft (W3). Prerequisite: an upstream release with `window.gridcraft.request`. Check the shared undo hazard and toggles (spike B) in the skill examples.
- [x] 10.5 Gate WordCraft (W3). Prerequisite: an upstream release with `window.wordcraft.request`. Record whether caret rebasing landed. If not, the skill's caret rule stays mandatory for WordCraft.
- [x] 10.6 Gate PhotoCraft (W3). Prerequisite: an upstream release with `window.photocraft.request`.
- [x] 10.7 Gate LightCraft (W1, non-blocking, `page-command`). There is no upstream prerequisite: `globalThis.lightcraft.command` exists in the pinned 0.9.1 and in 0.13.0.
  - Check that the global survives the post-install externalization of the inline module.
  - Record a `digestCommand` (a state-read command) and the create command for 8.3.
  - Check how an agent-triggered save reaches the shim.

  Ends `enabled` (at the pinned or a bumped version) or `pending` with the reason.
- [x] 10.8 Gate PdfCraft (W3). Prerequisite: an upstream release with `window.pdfcraft.request`.
- [x] 10.9 Gate DesignCraft (W3). Prerequisite: an upstream release with `window.designcraft.request`.
- [x] 10.10 Gate SoundCraft (W3). Prerequisite: an upstream release with `window.soundcraft.request`.
- [x] 10.11 Gate DeckCraft (W3). Prerequisite: an upstream release with `window.deckcraft.request`.
- [x] 10.12 Gate CADCraft (W3). Prerequisite: an upstream release with `window.cadcraft.request`.
- [x] 10.13 Gate FigCraft (W3). Prerequisites: an upstream release with `window.figcraft.request` and a FigCraft editor-pane claim (separate change). Without the claim it stays `pending`, even if the API exists.

## Workflow follow-up

- A `pending` app whose prerequisite later appears is enabled in a small follow-up change that runs the 10.x gate procedure. A transport other than `page-api` also needs a new profile `kind`.
