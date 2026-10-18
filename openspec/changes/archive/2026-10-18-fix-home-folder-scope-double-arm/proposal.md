## Why

Every Monday 09:00 the global automation `consolidate-hermes-memory`
(`~/.pi/automation/consolidate-hermes-memory/`, `cron: "0 9 * * 1"`) runs
**twice**, and each run copies a 765 MB `sessions.db` backup.

`~/.pi/dashboard/server.log` shows one server process starting two runs of the
same definition for every occurrence, one under each scope label:

| Occurrence | `global:` parent run | `folder:` parent run |
|---|---|---|
| 2026-09-21 | `…-00055` | `…-00057` |
| 2026-09-28 | `…-00395` | `…-00397` |
| 2026-10-05 | `…-00009` | `…-00011` |
| 2026-10-12 | `…-00315` | `…-00317` |

Cause: `folderScopeBases()` adds every live session cwd as a folder scope
(`packages/automation-plugin/src/server/index.ts:292-307`), with no home-dir
check. When a session's cwd is `$HOME`, the scanner reads
`<base>/.pi/automation` = `~/.pi/automation` a second time, as scope `folder`.
Every global automation is then armed under two keys (`global:<name>` and
`folder:<name>`), and concurrency `skip` is per key, so both fire.

No user action is needed to get there. A global run spawns its session with
cwd = the scope base = `$HOME` (`engine.ts:1063-1064`), so a global
automation's own run session is a live `$HOME` session. The activity rescan
(`index.ts:492-499`) then arms the folder copy.

The board has the same defect: `GET /api/plugins/automation/list` scans
global unconditionally and folder whenever `cwd` is set (`routes.ts:196`). With
`cwd=$HOME` it lists every global automation twice, and Run-now on the
`folder` copy starts a `folder:<name>` run that does not collide with an
active `global:<name>` run.

Contributed bases already guard against exactly this: a contributed base equal
to the home dir is dropped "so it does not double-arm as both `folder` and
`global`" (`folder-scope-contributions.ts:36-37`, enforced at `:76`; spec
`automation-folder-scope-contribution`, "Contributed base equal to home dir
does not double-arm"). Session cwds never got the same rule.

`fix-automation-key-collision` does not cover this: it changes the key to
`` `${scope}:${dir}` ``, and `global:` and `folder:` stay distinct.

## What Changes

- While global-scope scanning is enabled, `listScopes()` SHALL NOT return a
  folder scope whose resolved base equals the global home dir, whatever its
  source (session cwd or contribution). `~/.pi/automation` is then scanned,
  armed, reaped and watched once, under `global`.
- While global-scope scanning is enabled, `GET /api/plugins/automation/list`
  SHALL NOT scan `cwd` as a folder when it resolves to the home dir. The route
  always lists global automations, so nothing is hidden. With global scanning
  off, the route keeps listing the folder copy, which is the armed one.
- With global scanning disabled (`scanGlobalScope: false`), a session in `$HOME`
  keeps arming `~/.pi/automation` as a folder scope, as today. It is then the
  only path that arms those automations. The pre-existing unconditional drop of
  a *contributed* home base is unchanged.
- Base equality uses `path.resolve`, as all folder-scope dedup does
  (`automation-folder-scope-contribution`: "the same `path.resolve` applied to
  session cwds, not `realpath`").

## Discipline Skills

- `review-code`: before commit.
- `systematic-debugging`: only if a RED test from `tasks.md` passes before the
  fix, which would mean this root cause is wrong.

No other discipline skill applies: no auth, untrusted input, latency budget,
new endpoint, or irreversible step.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `automation-folder-scope-contribution`: ADDED requirement "The global home
  directory is never also a folder scope".

## Known limitations

- A `$HOME` reached through a different spelling (a symlink, or a case variant on
  a case-insensitive filesystem) is not recognized, consistent with the
  `path.resolve`-only dedup rule.
- A direct API call to Run-now with `scope: "folder"` and `cwd=$HOME`, or to
  `runWorkItemViaEngine` (`index.ts:605`) with `cwd=$HOME`, still targets the
  folder copy. Both are explicit one-shot requests, and the board no longer
  offers that entry (it sends the listed entry's
  scope, `client/AutomationBoard.tsx:162`).

- With global scanning off and `cwd=$HOME`, the board keeps listing each home
  automation twice (`global`, not armed, and `folder`, armed), because `/list`
  always scans global (`routes.ts:196`). This is pre-existing and unchanged.

## Impact

- `packages/automation-plugin/src/server/index.ts` — `listScopes()`.
- `packages/automation-plugin/src/server/routes.ts` — `/list` folder scan, plus an
  optional `scanGlobalScope?: () => boolean` route hook (absent = `true`).
  `index.ts` provides it at mount time as
  `() => ctx.getPluginConfig<AutomationPluginConfig>()?.scanGlobalScope !== false`,
  read per request. It cannot use `pluginConfig()`, which is local to
  `initEngine`.
- Tests in `packages/automation-plugin/src/__tests__/`.
- User-visible: each global automation runs once per occurrence while a session
  is open in `$HOME`, instead of twice. Changelog line.
- In-flight `folder:` runs at deploy finish normally: they complete through
  their captured key (`engine.ts:566` for batch parents, `:616` otherwise), and their records live under the same
  base as `global:` runs (`scopeBaseFor`, `engine.ts:650-657`).
- No data, API, or migration change. Rollback = revert. Deploy = server restart.
