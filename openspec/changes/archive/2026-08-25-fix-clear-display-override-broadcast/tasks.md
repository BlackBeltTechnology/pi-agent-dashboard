## 1. Server — broadcast the null sentinel

- [x] 1.1 In `packages/server/src/browser-handlers/session-meta-handler.ts` `handleSetSessionDisplayPrefs`, broadcast `updates.displayPrefsOverride: null` when `override === null` (keep `sessionManager.update` + disk write using `undefined`/field-deletion). Follow design D1.
- [x] 1.2 Add a server-handler test asserting the clearing broadcast payload survives `JSON.stringify`/`JSON.parse` with `displayPrefsOverride === null` (i.e. the key is not dropped). Verify it fails before 1.1 and passes after. Follow design D3(a).

## 2. Client — normalize null to undefined

- [x] 2.1 In `packages/client/src/App.tsx` `getSessionOverride`, return `sessions.get(sessionId)?.displayPrefsOverride ?? undefined` so a `null` record normalizes to `undefined`. Follow design D2.
- [x] 2.2 Audit direct `session.displayPrefsOverride` reads (e.g. `App.tsx:1843`/`1845` token-stats/context overrides) to confirm they use optional chaining so a transient `null` is safe (`null?.x === undefined`). Note findings in the apply summary. Follow design "Risks".
- [x] 2.3 Add a client test asserting `getSessionOverride` returns `undefined` for a session whose record is `{ displayPrefsOverride: null }`, that `useDisplayPrefs` merges to pure global prefs, and that the `ChatViewMenu` "modified" pill does not render. Verify it fails before 2.1 and passes after. Follow design D3(b).

## 3. Verify & rebuild

- [x] 3.1 Run `npm test` (pipe to tmp + grep per AGENTS.md) — all display-prefs tests green. The 15 remaining failures are pre-existing `fs.watch`/real-subprocess timing flakes (automation-watcher, faux-session, file-watch-manager, folder-head-watcher, openspec-change-watcher-fs) that fail identically with this change stashed — unrelated to this diff.
- [x] 3.2 Rebuilt client (`npm run build` — green) and restarted the server (`/api/restart` — 200). Verified at both seams by unit tests (1.2 + 2.3). Live browser check against the running :8000 server reproduced the ORIGINAL bug ("modified" pill persists after "Use global settings") — expected, because that server runs from cwd `/home/botond/pi-packages/pi-agent-dashboard` (main repo), NOT this worktree, so it executes pre-fix code. A from-worktree live check needs a separate server instance on an alternate port (pi-gateway/`~/.pi/dashboard` contention risk) and was deferred per user decision; fix correctness rests on the two passing unit tests.
- [x] 3.3 `openspec validate fix-clear-display-override-broadcast --strict` passes.
