# fix-resume-clobbers-dashboard-state

## Why

When a user renames a session in the dashboard (e.g. "My Important Session"), then ends it, then resumes it via the Resume button, the user-set name silently reverts. The bridge re-registers the session and supplies `params.name` from pi's session JSON — which doesn't know about dashboard renames — and the upsert in `sessionManager.register(...)` lets `params.name` win over the persisted `existing.name`.

The bug is reproducible end-to-end via the REST API:

```
$ curl -X POST /api/session/<id>/rename -d '{"name":"Important work"}'
  → name="Important work"
  → name persisted to .meta.json on disk via metaPersistence.save (server.ts:165)

$ curl -X POST /api/session/<id>/shutdown -d '{}'
  → status=ended  (name retained in .meta.json)

$ curl -X POST /api/session/<id>/resume -d '{"mode":"continue"}'
  → bridge spawns pi → bridge sends session_register { name: <bridge value> }
  → memory-session-manager.ts:68  name: params.name ?? existing?.name
                                        ──────────
                                        bridge value wins, user rename lost
```

`hidden` and `status` are deliberately not in scope — clicking Resume on a hidden ended session is *supposed* to un-hide it and bring it back to active. That's intentional UX. Only `name` is wrong.

## What Changes

- **MODIFIED**: `sessionManager.register(...)` (in `packages/server/src/memory-session-manager.ts`) reverses the precedence for `name`:
  - From: `name: params.name ?? existing?.name`
  - To:   `name: existing?.name ?? params.name`
- New sessions (no `existing` row) still take the bridge's `name` exactly as before.
- Resumes / reconnects of a previously-known session preserve the dashboard's persisted name, matching the pattern already used right above for `attachedProposal`, `contextWindow`, `tokensIn/Out`, `cost`, etc.
- **No change** to `hidden`, `status`, `firstMessage`, `event-wiring.ts`, persistence, protocol, or client code.

The persistence chain that makes this fix safe is already in place:
1. Rename via `/api/session/:id/rename` → `sessionManager.update({name})` → `onChange` fires → `metaPersistence.save({name, ...})` writes `.meta.json` on disk.
2. Server restart → `session-bootstrap.ts` reads `.meta.json` → `sessionManager.restore({name, ...})` populates the in-memory map.
3. Resume → bridge sends `session_register` → `register()` sees `existing.name` and (with this fix) keeps it.

## Capabilities

### Modified Capabilities
- `session-rename`: adds an explicit requirement that the user-set `name` survives bridge re-register / session resume / server restart. The current spec describes the rename API and display-name derivation but does not state this preservation contract.

## Impact

- **One line** changed in `packages/server/src/memory-session-manager.ts`.
- **One new test scenario** in `packages/server/src/__tests__/memory-session-manager.test.ts` verifying name preservation across re-register.
- **One spec delta** in `openspec/specs/session-rename/spec.md` adding the preservation requirement.
- **No client work, no new dependencies, no new protocol surface, no migration**. Existing `.meta.json` already stores `name`; the in-memory upsert was the only place dropping it.
