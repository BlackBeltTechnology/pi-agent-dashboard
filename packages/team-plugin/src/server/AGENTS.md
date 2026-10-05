# DOX — packages/team-plugin/src/server

Server entry + services. Host reached only through the narrow `HostPort` (`conversations.ts`), so the stack is testable with a fake. One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `access.ts` | `createAccess(identity, config)`: mode (`multi` iff identity enforced) + `callerOf(request)` → `Caller` (`uk`, admin flag from `admins`); single-user = local operator (admin). null ⇒ 401. See change: add-team-plugin. |
| `conversations.ts` | `ConversationService`: create (lock per user×persona×target, limit), ensure (single-flight; reuse → resume → `409 conversation_unrecoverable`), spawn+bind (runId/spawnToken, `team_guard_ready` wait, 30 s timeout → abort), titles, archive/restore/delete/restart, `agents()` cards (D8 status), idle `sweepIdle`, `onEvent` (live only, persists `lastAgentEndAt`), `folderCounts`. Scope: `appendSystemPrompt`, `noContextFiles`, `noProjectTrust`, `sessionDir: piSessionDirForCwd`, tools preset from `extension/guard.ts`. Logs `team.ensure` ids only. See change: add-team-plugin. |
| `index.ts` | `registerPlugin(ctx)` default export: adapts `ServerPluginContext` to `HostPort`, resolves guard path + `dist/app`, `createTeam().start()`, `onShutdown(stop)`. See change: add-team-plugin. |
| `paths.ts` | `TeamPaths` layout under `TEAM_HOME` (`PI_TEAM_HOME` > config), `userKey` (sha256 `iss\0sub`→32 hex), slug/target/persona-key validators, `canonicalize` (longest existing ancestor realpath), `isInside`, `atomicWriteJson` + injectable `FsOps`. See change: add-team-plugin. |
| `persona.ts` | `validatePersonaInput` (code-point name/description, UTF-8 instructions, avatar, role, tools, `projects`, skills ∈ catalog; `full` only shared + single-user), `LIMITS`, `suffixedSlug`. Pure. See change: add-team-plugin. |
| `personas-service.ts` | create / update / delete / fork with admin + owner gates, caps (`409 persona_limit`), `slug_taken`, fork project filtering, `full`→`files`. See change: add-team-plugin. |
| `projects.ts` | `ProjectRegistry`: config projects (activation-accepted set, live `available`) + folder-enabled `projects.json`; `validatePath` (abs, dir, no overlap with team home / `~/.pi`); allowlist `canUse`; `resolveFolder` (equal else nearest containing; worktrees never match); `enable`/`patch`/`disable`. See change: add-team-plugin. |
| `records.ts` | `RecordStore`: one JSON per conversation under `users/<uk>/conversations/<t>/<scope>-<slug>/<c>.json`, session→locator index, `scanAll`. See change: add-team-plugin. |
| `render.ts` | `writePersonaFile` (persona.md outside every target, cwd-anchor literal neutralised), `collectContextFiles` (root `AGENTS.md`/`CLAUDE.md`, inside root, regular, ≤ 64 KiB). See change: add-team-plugin. |
| `routes.ts` | REST `/api/plugins/team/*` in an encapsulated scope with the shared rate limiter + own error handler (`TeamError` → `{error}`); `/me` returns `maxConversations` + catalog `skills`. See change: add-team-plugin. |
| `static.ts` | `/apps/team` → 308; `/apps/team/*` file under `dist/app/` (realpath-confined) else `index.html`; `503` when the build is missing. See change: add-team-plugin. |
| `store-types.ts` | Read-side `PersonaStore` interface for the conversation service. See change: add-team-plugin. |
| `store.ts` | `PersonaStore`: atomic per-persona JSON, unknown `schemaVersion` skipped with warning, `private:` keys resolve in the caller's folder only. See change: add-team-plugin. |
| `team.ts` | `createTeam(deps)` composition root: builds paths/stores/services, mounts routes + app routes, starts the conversation lifecycle. See change: add-team-plugin. |
| `text-write.ts` | `atomicWriteText` (tmp + rename). See change: add-team-plugin. |
| `types.ts` | `Persona`, `Caller`, `ConversationRecord`, `Project`, `TeamConfig`, `TeamError(status, code)`, `WORKSPACE_TARGET = "_ws"`. See change: add-team-plugin. |
| `users.ts` | `UsersStore`: known users recorded on `GET /me` (`lastSeenAt`) for the folder-enable picker. See change: add-team-plugin. |
