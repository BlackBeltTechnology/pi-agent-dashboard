## Why

A folder the sidebar renders but the server's cwd guard does not admit (e.g. `/Users/robson/Project/rackinspect` — only archived sessions, not pinned) shows the KB pill as red **"index failed"** with tooltip `cwd not allowed`. Nothing failed: `GET /api/kb/stats` returns `403` before any index runs. The user sees a fake failure, `Retry` can never succeed, and the real fix (pin the folder) is hidden in the tooltip.

## What Changes

- KB client distinguishes a cwd-guard refusal (`403` whose body is `error: "cwd not allowed"`) from a genuine failure. Other 403s (network / host / tier gates) keep today's error behavior.
- New pill state `denied`: non-error (not red) label "not allowed", localized tooltip naming the pin remedy, no `Retry`.
- `denied` state offers ONE action **Pin folder** — sends the existing `pin_directory` WS verb for the folder cwd (only while connected); while denied, the row re-fetches stats on any `pinned_dirs_updated` broadcast (no client-side path matching; a still-refused refetch is self-correcting), so ANY pin path (this control, sidebar toggle, pin dialog) resolves the pill to its real state.
- A cwd refusal is definitive: the stats store stops polling immediately instead of spending `MAX_POLL_MISSES` retries.
- Card placement: the sibling reindex button becomes the Pin control in `denied`. Sidebar placement: the folder-menu maintenance item becomes "Pin folder".
- Server guard, `knownFolderCwds`, and 403 body are UNCHANGED (option B — admitting archived-only folders — is explicitly out of scope).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `kb-plugin-stats`: "Live polling while indexing" — a cwd refusal stops polling even mid-job; "Optimistic reindex acknowledgement" — a cwd-refused trigger surfaces denied, not a reindex error; "Bounded poll-miss tolerance and error surfacing" — a cwd refusal is definitive (no miss-run); "Shared per-folder stats state across consumers" — the refusal and pin-wait are shared folder state.
- `kb-folder-slot`: "KB row reflects index state" — a `403` cwd-guard refusal renders a `denied` state with a Pin action instead of the failed/Retry state.
- `kb-plugin-folder-section`: "Section state and open-settings affordance" — adds `denied` (top of the ordered states); "Reindex action affordance" — the single KB action becomes "Pin folder" in `denied`; "Error state from client-side and poll failures" — cwd refusals are excluded from `error` and drive `denied`.

## Impact

- `packages/kb-plugin/src/client/kb-api.ts` — typed refusal error in the SHARED `parseJson` (all eight kb-api calls); `message` stays `json.error`, so non-KB-row consumers (`KbTestSearch`, config, sources) see byte-identical text.
- `packages/kb-plugin/src/client/kb-stats-store.ts` — `denied` snapshot field; 403 stops polling; `refetch` after pin.
- `packages/kb-plugin/src/client/useKbStats.ts` — exposes `denied`, `deniedReason`, `pinPending`, `beginPinWait`.
- `packages/kb-plugin/src/client/FolderKbSection.tsx` — `denied` state render, Pin control/menu item via `usePluginSend`.
- `packages/kb-plugin/src/i18n.ts` — six keys (`labelNotAllowedShort`, `titleDenied`, `labelPinningShort`, `pinFolder`, `pinOffline`, `labelOffline`) added to `zh-CN` AND `hu` in the same commit (parity gate).
- Tests: `kb-stats-store` / `useKbStats` / `FolderKbSection` vitest.
- No server, protocol, or persistence change → no migration; rollback = revert client commit.
- `KbSettingsPanel` untouched — it already shows the refusal via its own config load.

## Discipline Skills

- `review-code` — non-trivial client change before commit.
- `security-hardening` not triggered: the server guard is untouched; Pin reuses the existing user-initiated `pin_directory` verb (same admission path as the sidebar pin button), so no new trust boundary.
