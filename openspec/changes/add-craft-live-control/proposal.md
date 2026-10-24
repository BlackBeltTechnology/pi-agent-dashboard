# Proposal

## Why

A Craft app open in the editor pane cannot be driven by the session it belongs to. Today an agent can only edit the file headlessly (`pi-craft <app> run`) and the pane must reload. A reload loses the user's cursor, scroll position, undo history and any unsaved edits, and every save/reload round trip goes through the file format. The user wants to say "bold the header row" while the spreadsheet is open, see the change land live, and be able to Ctrl+Z it.

A spike (2026-10-24, `/tmp/spikeB`) showed the Craft apps already contain the full desktop control protocol inside their web builds. It runs every frame on the same `control_rx` channel the desktop TCP control server feeds; only a web transport is missing:

- **VectorCraft ≥ 0.14** ships that transport upstream as `window.vectorcraft` (`request`, `execute`, `commands`, `inspect`, `screenshot`). We pin web 0.13.1.
- **FilmCraft (≥ 0.5) and EffectCraft (≥ 0.8)** ship the same page API (`window.filmcraft`, `window.effectcraft`). Neither has an editor-pane claim yet; their project files are owned by `add-craft-web-media-projects`.
- **GridCraft 0.11.1** (patched `host.rs`, ~70 lines) and **WordCraft 0.10.0** (new `control_bridge.rs`, ~90 lines), both built with trunk:
  - Embedded in our production sandbox and CSP; WordCraft also ran behind our real post-install shim.
  - Control requests round-trip in p50 7 ms (GridCraft) and 12 ms (WordCraft).
  - The user's cursor and scroll position are kept; real mouse and keyboard input interleave with agent commands.
  - The user can undo an agent edit.
  - An agent-triggered `file.save` reaches the host through the existing save path.
- Two hazards an agent must respect:
  - **Shared undo history:** the agent's `edit.undo` undid the user's typing.
  - **WordCraft caret is not rebased:** WordCraft edits at the caret. After an agent `edit.replaceAll` before the caret, the user's next keystrokes landed 8 characters early. Some commands toggle (`home.bold` turned bold off).

## What Changes

- **Agent tool `craft_control`** (plugin bridge entry): runs one control-protocol method against the Craft document the session has open in a dashboard editor pane. The document is addressed by workspace path. Results come back as tool output. When no viewer has the file open, the tool fails with a clear "not open in the dashboard" error. It does not fall back to headless editing, so the agent chooses `pi-craft` deliberately.
- **Request routing** (plugin server): resolves a request to exactly one live editor instance of that session's file across connected browsers, and returns its reply or a bounded error (`not-open`, `ambiguous`, `busy`, `timeout`, `unsupported`).
- **Frame relay** (client host + shim v3): a nonce-bound `control` / `control-result` message pair between `CraftFrameHost` and the shim. The shim forwards each request to the app's in-page control API (`page-api` profile kind, e.g. `window.vectorcraft.request`). Other transports (such as the proposed upstream `craft:control` message) are added in a follow-up once upstream ships them.
- **Agent edits behave like user edits:**
  - they mark the tab unsaved, so close, eviction and reload guards apply;
  - agent saves take exactly the user's save routing (save-target choice, first-overwrite notice, sibling question, conflicts); the agent reads the outcome afterwards (`host.state`) instead of waiting on dialogs;
  - a device download with no recent user input in the editor asks the user first, so agent-triggered exports never land silently, while the user's own exports work as before.
- **Per-app opt-in** via a new profile field `control`. It includes a per-app allowlist of nested commands, valid only for the verified build version. Apps without it report `unsupported`. Every app is enabled only through the same per-app gate (re-spike under the production sandbox, derived allowlist, e2e rows). Rollout waves:
  - **W1, VectorCraft** (web ≥ 0.14, pin bump from 0.13.1). This gate blocks the change: if it fails, nothing ships.
  - **W2, FilmCraft and EffectCraft**: their page APIs already exist. Each is enabled once `add-craft-web-media-projects` has shipped its `.fcproj` / `.ecproj` edit claim (see Dependencies).
  - **W3, the other ten apps** (GridCraft, WordCraft, PhotoCraft, LightCraft, PdfCraft, DesignCraft, SoundCraft, DeckCraft, CADCraft, FigCraft): each is enabled once upstream releases `window.<app>.request`. FigCraft also needs an editor-pane claim, which is out of scope here.
  - A W2/W3 gate whose prerequisite is absent when the change ships ends as a recorded "pending" row (prerequisite + upstream issue URL), so the change does not wait on upstream. Enabling it later is a small follow-up using the same gate.
- **User visibility:** the tab shows a non-blocking "agent is editing" indicator while a request is in flight, and every agent request is listed in a per-tab activity log. Edits stay undoable by the user through the app.
- **Skill `craft-live-edit`** (shipped with the craft-web plugin, next to its tool):
  - when to use live control vs `pi-craft` headless;
  - read state before toggling commands;
  - never call `edit.undo` blindly;
  - caret-based apps: save the selection → edit → restore it, and do not edit before the user's caret in the same block while they type;
  - save only when asked, with the app's save command via `engine.execute`; read the outcome with `host.state`.

## Capabilities

### New Capabilities
- `craft-live-control`: an agent session drives a Craft document that is open in a dashboard editor pane through the app's control protocol. Covers addressing, single-instance routing, the frame relay contract, per-app opt-in, user visibility, error model and limits.

### Modified Capabilities
- `craft-web-editor`: new requirement. For a control-enabled app, the frame may receive control requests from the host, which the shim passes only to the app's declared control transport. No existing guarantee is relaxed: isolation, CSP, tab's-file-only and the save path all stay as they are.

## Impact

- `packages/craft-web-plugin`:
  - `src/shared/app-profiles.ts` (`control` field; entries for the apps whose gate passes);
  - `src/shim/craft-shim.js` (v3: relay, `SHIM_VERSION` bump → re-prepare);
  - `src/client/frame-session.ts` + `CraftFrame.tsx` (relay, indicator, activity log);
  - `src/client/` control registry (`usePluginMessage` / `usePluginSend`);
  - `src/server/` routing (`registerPiRequestHandler`, session-scoped `broadcastToSubscribers`, `registerBrowserHandler`);
  - new `src/bridge/` entry (`craft_control` tool);
  - `.pi/skills/craft-live-edit/`;
  - `package.json` manifest (bridge, `pi.skills`).
- `packages/craft-apps`: `webVersion` bumps in `src/registry.ts` for each app whose gate passes (VectorCraft at least); `craft-studio` links the new skill.
- Shim v3 plus a `control` entry in an app's frame profile → that app re-prepares, which its version bump forces anyway. FilmCraft and EffectCraft get their entry together with their new claims. Other apps keep their current trees and `minShimVersion`.
- `docs/craft-web-plugin.md`: a live-control status table for all 13 apps (state, prerequisite, upstream issue).
- No core changes: uses existing seams (request/reply lane, operate-tier plugin browser messages, session-scoped broadcast). The server never sends on a raw socket.
- Upstream dependency (not code here): a `window.<app>` page API, as VectorCraft, FilmCraft and EffectCraft already ship, for the ten W3 apps, plus WordCraft caret rebasing. A page API runs inside the frame, so it needs no cross-origin support. Draft issue: `/tmp/spikeB/upstream/ISSUE.md`.

## Dependencies

- **`add-craft-web-media-projects`**: W2 only. FilmCraft and EffectCraft documents can be open in the pane only after that change ships their `.fcproj` / `.ecproj` edit claims. W1 and the shared machinery do not depend on it. If it records a no-go, W2 ends as recorded "pending" rows.

## Discipline Skills

- `security-hardening`: new agent→frame command path. Who may drive whose open document (session scoping is a correctness guard, not authentication; multi-device viewers; observe-only clients); replies from a third-party bundle flow into the model as untrusted data; the relay must not widen frame isolation.
- `observability-instrumentation`: new external-call path. Per-request outcome counters (ok / not-open / ambiguous / timeout / unsupported) and latency, in line with the existing craft-web telemetry counters.
- `doubt-driven-review`: the shim message contract and the `window.<app>` page-API shape we ask upstream to adopt are effectively public protocol; review them before they stand.
