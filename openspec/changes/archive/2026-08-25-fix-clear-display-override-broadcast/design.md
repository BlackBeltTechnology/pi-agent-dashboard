## Context

Per-session display overrides live on `Session.displayPrefsOverride` (a sparse `PartialDisplayPrefs`), deep-merged over global prefs by `mergeDisplayPrefs`. The `ChatViewMenu` "Use global settings" button sends `setSessionDisplayPrefs { sessionId, override: null }` to clear.

Server `handleSetSessionDisplayPrefs` (`session-meta-handler.ts`):
1. `sessionManager.update(id, { displayPrefsOverride: undefined })` — in-memory clear.
2. `metaPersistence.setDisplayPrefsOverride(file, null)` — deletes the `.meta.json` field.
3. `broadcast({ type: "session_updated", updates: { displayPrefsOverride: undefined } })`.

Step 3 is the defect. The broadcast is serialized via `JSON.stringify` in `browser-gateway.ts` (line 491). `JSON.stringify` **omits keys whose value is `undefined`**, so the wire payload becomes `{ type:"session_updated", updates:{} }`. The client `session_updated` handler (`useMessageHandler.ts`) merges `{ ...existing, ...updates }`; an empty `updates` clears nothing, so the stale override survives until a full reload (which re-fetches from the corrected `.meta.json`).

The `chat-display-preferences` spec already prescribes the fix: broadcast `null`, and normalize `null → undefined` in `getSessionOverride`. The code never complied.

```
click "Use global settings"
   └─ WS setSessionDisplayPrefs { override: null }
        └─ server: mem clear ✅  disk clear ✅
             └─ broadcast { updates: { displayPrefsOverride: undefined } }
                  └─ JSON.stringify → {"updates":{}}   ← key dropped
                       └─ client { ...existing, ...{} } → override SURVIVES ❌
```

## Goals / Non-Goals

**Goals:**
- Live "Use global settings" clears the override in every connected browser without reload.
- Bring code into compliance with the existing `chat-display-preferences` requirement + its scenarios.
- Keep the on-disk / in-memory representation of "no override" as absent/`undefined` (only the wire payload gains the `null` sentinel).

**Non-Goals:**
- No change to the REST `PATCH /api/preferences/display` path or the `display_prefs_updated` broadcast.
- No change to `setSessionDisplayPrefs` protocol types (`override` is already `PartialDisplayPrefs | null`).
- No refactor of the client `session_updated` spread-merge (the `null` sentinel + normalization is sufficient and localized).

## Decisions

**D1 — Broadcast `null`, not `undefined`, on clear.** In `handleSetSessionDisplayPrefs`, send the broadcast with `updates.displayPrefsOverride: null` when `override === null`. `null` survives `JSON.stringify`, so connected browsers receive `updates: { displayPrefsOverride: null }` and the spread-merge overwrites the stale value. The in-memory `sessionManager.update` and disk write keep using `undefined`/field-deletion — only the broadcast payload carries the sentinel.

*Alternative rejected:* have the client special-case an empty `updates` — impossible, since "field absent" is indistinguishable from "field unchanged" in a sparse partial-update message.

**D2 — Normalize `null → undefined` in `getSessionOverride`.** After D1, a cleared session transiently holds `displayPrefsOverride: null` in the client `sessions` map. `getSessionOverride` (`App.tsx`) returns `override ?? undefined` so `mergeDisplayPrefs` and the `ChatViewMenu` "modified" pill treat `null` as "no override." This matches the spec's normative sentence verbatim and keeps `null` from leaking into `mergeDisplayPrefs` (which expects `PartialDisplayPrefs | undefined`).

**D3 — Regression coverage at two seams.** (a) A server-handler test asserting the broadcast payload survives a `JSON.stringify`/`JSON.parse` round-trip with `displayPrefsOverride === null`. (b) A client test asserting `getSessionOverride` returns `undefined` for a `null` record and that `useDisplayPrefs` merges to pure global. These pin the exact seams the original code missed.

## Risks / Trade-offs

- **`null` leaking into `mergeDisplayPrefs`:** mitigated by D2 normalizing at the single read seam (`getSessionOverride`) that every consumer (`useDisplayPrefs`, `ChatViewMenu` `currentOverride`) flows through. Direct `session.displayPrefsOverride` reads elsewhere (e.g. `App.tsx:1843` token-stats override) would see `null` transiently; audit confirms those use optional chaining (`?.tokenStatsBar`) so `null?.x === undefined` — safe. Verify during apply.
- **Low blast radius:** two one-line changes plus tests; no protocol or persistence-format change, so no migration and no cross-version concern.
