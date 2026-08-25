## Why

Clicking **"Use global settings"** in the per-session ⚙ View popover (`ChatViewMenu`) does nothing in the live UI — the session keeps showing its overrides until a full page reload. The server clears the override on disk and in memory correctly, but the `session_updated` broadcast carries `updates.displayPrefsOverride: undefined`, and `JSON.stringify` drops `undefined`-valued keys, so the payload reaches every connected browser as `updates: {}`. The client's spread-merge (`{ ...existing, ...updates }`) then has nothing to clear and the stale override survives.

The `chat-display-preferences` spec already mandates the correct behavior — the server MUST broadcast `displayPrefsOverride: null` (not `undefined`) and the client's `getSessionOverride` MUST normalize `null` to `undefined` (see the requirement "Display prefs SHALL be controllable via REST and broadcast over WS" and its "Clearing override broadcasts null, not empty" scenario). The code never complied. This change brings the implementation into line with the existing spec.

## What Changes

- Server `handleSetSessionDisplayPrefs` (`session-meta-handler.ts`) SHALL broadcast `updates.displayPrefsOverride: null` when clearing (rather than `undefined`), so the field survives `JSON.stringify` and reaches connected browsers.
- The in-memory `sessionManager.update` and the synchronous `.meta.json` write SHALL continue to delete the field (`undefined` on disk / in memory is unchanged — only the wire payload gains the `null` sentinel).
- Client `getSessionOverride` (`App.tsx`) SHALL normalize a `null` override to `undefined` before returning it to consumers, so `mergeDisplayPrefs` and the "modified" pill treat a cleared session as having no override.
- Regression test asserting the broadcast round-trips through `JSON.stringify` without losing the clear, and that a browser applying the broadcast drops the override.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `chat-display-preferences`: the requirement "Display prefs SHALL be controllable via REST and broadcast over WS" already mandates the null-broadcast contract AND the client `null → undefined` normalization, but the client-normalization half lives only in prose with no scenario — which is why the non-compliant code shipped undetected. The delta adds an explicit, independently-testable "Client normalizes cleared override" scenario. No normative wording changes; the requirement text is unchanged.

## Discipline Skills

- `systematic-debugging`: root cause already isolated (JSON drops `undefined` keys on the `session_updated` broadcast); tasks encode the evidence-first red-test-before-fix loop rather than guessing.
- `review-code`: run before commit — the fix touches a WS broadcast seam consumed by every browser, so verify the `null` sentinel does not leak into `mergeDisplayPrefs` (design D2/Risks).
- No `security-hardening` / `performance-optimization` / `observability-instrumentation`: no untrusted input, no latency budget, no new endpoint or external call.

## Impact

- `packages/server/src/browser-handlers/session-meta-handler.ts` — broadcast payload sentinel.
- `packages/client/src/App.tsx` — `getSessionOverride` null-normalization.
- Behavior only; no protocol type change (`setSessionDisplayPrefs.override` already `PartialDisplayPrefs | null`; `session_updated.updates.displayPrefsOverride` is optional and now legitimately carries `null` on clear).
- Rebuild: server restart (`/api/restart`) + client build (`npm run build`).
