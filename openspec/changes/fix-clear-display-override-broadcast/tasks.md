## 1. Server — broadcast the null sentinel

- [ ] 1.1 In `packages/server/src/browser-handlers/session-meta-handler.ts` `handleSetSessionDisplayPrefs`, broadcast `updates.displayPrefsOverride: null` when `override === null` (keep `sessionManager.update` + disk write using `undefined`/field-deletion). Follow design D1.
- [ ] 1.2 Add a server-handler test asserting the clearing broadcast payload survives `JSON.stringify`/`JSON.parse` with `displayPrefsOverride === null` (i.e. the key is not dropped). Verify it fails before 1.1 and passes after. Follow design D3(a).

## 2. Client — normalize null to undefined

- [ ] 2.1 In `packages/client/src/App.tsx` `getSessionOverride`, return `sessions.get(sessionId)?.displayPrefsOverride ?? undefined` so a `null` record normalizes to `undefined`. Follow design D2.
- [ ] 2.2 Audit direct `session.displayPrefsOverride` reads (e.g. `App.tsx:1843`/`1845` token-stats/context overrides) to confirm they use optional chaining so a transient `null` is safe (`null?.x === undefined`). Note findings in the apply summary. Follow design "Risks".
- [ ] 2.3 Add a client test asserting `getSessionOverride` returns `undefined` for a session whose record is `{ displayPrefsOverride: null }`, that `useDisplayPrefs` merges to pure global prefs, and that the `ChatViewMenu` "modified" pill does not render. Verify it fails before 2.1 and passes after. Follow design D3(b).

## 3. Verify & rebuild

- [ ] 3.1 Run `npm test` (pipe to tmp + grep per AGENTS.md) — all green.
- [ ] 3.2 Restart server (`curl -X POST http://localhost:8000/api/restart`) and rebuild client (`npm run build`), then manually confirm: with a session showing overrides, click "Use global settings" → overrides clear live and the "modified" pill disappears without a page reload; a second connected browser also clears.
- [ ] 3.3 `openspec validate fix-clear-display-override-broadcast --strict` passes.
