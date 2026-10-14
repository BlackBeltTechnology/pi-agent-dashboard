## Context

Two independent "default model" stores exist:

| Store | File | Writer today | Reader |
|---|---|---|---|
| Dashboard default | `~/.pi/dashboard/config.json` → `defaultModel` (`provider/id`), `defaultThinkingLevel` | `PUT /api/config` → `writeConfigPartial` (`packages/server/src/routes/system-routes.ts:518-545`, `packages/server/src/config-api.ts:210`) | bridge, which calls `pi.setModel()` only for brand-new spawned sessions (spec `bridge-extension` → "Default model applied only to brand-new sessions") |
| pi default | `~/.pi/agent/settings.json` → `defaultProvider`, `defaultModel` (bare id), `defaultThinkingLevel` | nobody in the dashboard | pi `SettingsManager` at every session construction, incl. SDK child sessions created by `createAgentSession` (subagents) |

The only existing dashboard writer of `settings.json` is the retry editor:
`packages/server/src/pi-agent-settings.ts` (merge-preserving `retry` write, no lock) behind
`packages/server/src/routes/pi-retry-routes.ts` (`GET/PUT /api/pi-retry`, `networkGuard`,
then `reloadConnectedSessions()`), registered at `packages/server/src/server.ts:2264-2279`. Its UI
`packages/client/src/components/settings/RetrySettingsSection.tsx` commits through the unified Save via
`useSettingsDraftSource` (`RetrySettingsSection.tsx:16-24`) and is mounted on the Sessions page
(`SettingsPanel.tsx:2237`). The unified Save runs every dirty source CONCURRENTLY
(`SettingsPanel.tsx:953`, `Promise.allSettled`), so a config save and a pi-settings draft commit race
in undefined order.

pi's own writes go through `FileSettingsStorage.withLock`, which takes
`proper-lockfile.lockSync(<settings.json>, { realpath: false })` with 10 × 20 ms retry on the UNRESOLVED
settings path, so the lock artifact is `<settings.json>.lock` even when the file is a symlink
(`proper-lockfile/lib/lockfile.js` `getLockFile` = `file + ".lock"`). When the file is absent pi reads
unlocked and locks just before its first write
(`node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:126-173`). pi strips a BOM
before parsing (`settings-manager.js:269,452`).
`FileSettingsStorage` is not exported from pi's index (`dist/index.d.ts:22`), and pi's `package.json`
`exports` map (`.`, `./rpc-entry`, `./client`, `./experimental/plugin`) blocks a deep import, so the
dashboard cannot reuse it. pi setters do NOT write immediately: they enqueue (`settings-manager.js:429-441`);
the queued task re-reads the file under the lock and overlays ONLY the fields pi modified
(`settings-manager.js:448-471`). `proper-lockfile` is already a server dependency
(`packages/server/package.json:103`). pi resolves its directory with `getAgentDir()`: `$PI_CODING_AGENT_DIR` (tilde-expanded) else
`~/.pi/agent` (`dist/config.js:476,491-496`); the dashboard already reads that variable for the sessions
dir (`packages/shared/src/dashboard-paths.ts:41-68`). pi still accepts and migrates the legacy
`skills: { customDirectories, enableSkillCommands }` object (`settings-manager.js:292-307`). The
authoritative key shape is pi's `Settings` interface
(`dist/core/settings-manager.d.ts`, `export interface Settings`). Valid thinking levels:
`THINKING_LEVELS` (`packages/shared/src/role-schema.ts:149`), identical to pi-agent-core's `ThinkingLevel`.

## Goals / Non-Goals

**Goals**
- Dashboard default model/thinking level and pi's default can no longer drift via the dashboard, and
  pre-existing drift can be repaired from the dashboard.
- Every key of the global `~/.pi/agent/settings.json` is viewable, and every key except the three
  mirrored default keys is editable directly (those are edited through the Default model control).
- Dashboard writes never interleave with pi's own writes (shared lock).
- A dashboard write never clobbers a change that reached the file before the dashboard took the lock
  (token re-checked under the lock → `409`).
- A rejected write leaves the file byte-identical.

**Not guaranteed (documented; not solvable from outside pi):**
- If a running pi process changed field F in memory before a dashboard write and its queued flush runs
  after it, pi's flush wins for F only (pi overlays just the fields it changed). The reload after every
  editor write (D7) keeps the window short.
- First-ever file creation: pi reads an ABSENT file unlocked and computes its content before locking
  (`settings-manager.js:155-171`). If the dashboard creates the file inside that window, pi's write then
  replaces it. Only possible when `settings.json` does not exist yet; every later write is fully
  serialised by the lock + token.

**Non-Goals**
- Project-scoped `<cwd>/.pi/settings.json` (never read or written by this change).
- Replacing the retry editor or `/api/pi-retry` (unchanged except the lock + `503` mapping, D5).
- Editing `auth.json`, `models.json`, `providers.json`.
- A complete typed form for every pi key (JSON mode covers the long tail).
- Deleting pi's three default keys from the dashboard: clearing the dashboard default means "do not
  override" (spec `shared-config`), so pi's keys stay.
- Live reload of the default model into running sessions (defaults only matter at construction).

## Decisions

### D1 — Mirror on dashboard save, server-side, only on change; explicit drift repair
In the `PUT /api/config` handler, after `writeConfigPartial` succeeds (`system-routes.ts:545`):
- Trigger: the save's partial carried `defaultModel` and/or `defaultThinkingLevel`.
- Values: read from the PERSISTED dashboard config INSIDE the pi settings lock (the mirror takes a
  config reader, not values). Whichever overlapping save takes the lock last therefore writes the final
  dashboard value — overlapping saves converge. Under the lock the mirror writes only keys whose pi
  value differs from the derived value.
- `defaultModel` non-empty → split on the FIRST `/`; write pi `defaultProvider` + `defaultModel`.
  No `/` → skip, report `piMirror: { ok: true, skipped: "no-provider-separator" }`; the UI shows this
  as a non-blocking info notice in the Default Model callout (values come from the model picker as
  `provider/id`, so this arises only from hand-edited config).
- `defaultThinkingLevel` non-empty valid level → write pi `defaultThinkingLevel`.
- Empty string (dashboard "unset") → pi keys untouched.
- pi's file unparseable → never write from `{}`; `piMirror: { ok: false, error: "parse" }`.
- Any other failure (busy, I/O) → logged, `piMirror: { ok: false, error }`; the config save still
  succeeds (config.json is already written).
- No mirror attempted → `piMirror` omitted. The mirror does not reload sessions.

**Drift repair:** `POST /api/pi-settings/sync-defaults` runs the same mirror from the CURRENT dashboard
config for BOTH keys (same lock/skip/parse rules, no reload). The pi settings section offers "Apply
dashboard default to pi" only when a derived value exists (non-empty, and for the model containing `/`)
and differs from pi's value; an empty or separator-less dashboard value derives nothing and never counts
as drift.

*Rejected:* client-side mirror (two requests, browser-owned partial failure). *Rejected:* drop the
dashboard key and use pi's file as the only source — breaks the bridge contract and existing specs.

### D2 — Mirrored keys are owned by the Default model control
`defaultProvider`, `defaultModel`, `defaultThinkingLevel` are read-only in the pi settings section. The
typed `PUT` rejects them (`400`). The raw `PUT` overwrites whatever the client sent for them with the
on-disk values read UNDER THE LOCK (present or absent) and returns `restoredKeys` (keys whose submitted
value differed from the written one) so API clients can observe the substitution. The UI does NOT use
`restoredKeys` for its notice — a concurrent mirror would make it fire spuriously; whether the USER
edited a managed key is a client-side fact (draft vs loaded baseline), so the client warns before
submit instead. The three keys are also excluded from the concurrency token (D4), so a mirror write in
the same unified Save never stales the pi-settings draft — either commit order converges.

### D3 — Typed form: curated, merge-preserving patch
Typed keys (pi `Settings` names): `compaction.enabled` (bool), `compaction.reserveTokens`,
`compaction.keepRecentTokens` (non-negative int), `branchSummary.reserveTokens` (non-negative int),
`branchSummary.skipPrompt` (bool), `steeringMode`, `followUpMode` (`"all" | "one-at-a-time"`),
`defaultProjectTrust` (`"ask" | "always" | "never"`), `hideThinkingBlock` (bool), `quietStartup`
(`true | false | "header"`). `PUT /api/pi-settings` is a PATCH over LEAF keys: only provided leaves change,
nested objects merge key-by-key, unknown sibling keys survive (same contract as `pi-retry-settings`). A
`null` leaf deletes the key (pi default applies); a whole block (`compaction`, `branchSummary`) cannot be
nulled. Any other key — including real pi keys like `shellPath` — is rejected with an
error pointing to JSON mode. Current file unparseable → `400 { parseError }`, nothing written (a patch is
never applied over `{}`; repair happens in JSON mode).

### D4 — Optimistic concurrency via a content token
`GET /api/pi-settings` → `{ settings, raw, etag, parseError? }`. `etag` = sha256 of the canonical form:
BOM stripped (as pi does, `settings-manager.js:269`), parsed, the three mirrored keys removed, keys sorted recursively,
`JSON.stringify`. Absent file → `"absent"`. Unparseable file → sha256 of the raw bytes. Every write
carries `baseEtag`; mismatch → `409 { error: "stale", etag, settings, raw }`, nothing written. Every
successful write returns the post-write `{ etag, settings, raw }` so the client re-baselines from what
was actually written. Sorting makes reformatting and key reordering (by pi or by hand) non-conflicts.

### D5 — Lock-coordinated atomic write
Async helper `withPiSettingsLock(fn)` in `pi-agent-settings.ts`. Callers validate and prepare the
submitted content BEFORE calling it, so the critical section is only re-read + token check + replace
(pi's own lock budget is ~200 ms; a long dashboard hold would make pi's queued write fail with
`ELOCKED`).
1. Settings path = `<agentDir>/settings.json` where `agentDir` follows pi's `getAgentDir()` precedence
   (`$PI_CODING_AGENT_DIR`, tilde-expanded, else `~/.pi/agent`) via a shared
   `resolvePiAgentDir()` in `packages/shared/src/dashboard-paths.ts`. Lock path = that UNRESOLVED path
   (same artifact as pi, also for a symlink).
   Write target = `realpath` of that path when it exists and is a link, else the path itself (pi's
   `writeFileSync` follows links; a rename onto the link path would replace the link).
2. `mkdir -p` the directory; ASYNC `proper-lockfile.lock(lockPath, { realpath: false, stale: 10_000,
   retries: { retries: 10, minTimeout: 20, maxTimeout: 20 } })` — same artifact and the same `stale` as
   pi's `lockSync` (pinned explicitly, not inherited from the library default),
   no busy-wait on the server event loop. Locked also when the file is absent (stricter than pi, which
   reads unlocked then locks before writing; compatible because both sides lock before writing).
3. Under the lock: re-read (BOM stripped), recompute + compare the etag, run `fn(currentParsed)` (pure,
   in-memory), write a tmp file in the target's directory, `chmod` it to the target's `fstat` mode when
   the target exists (a new file gets the process default, same as pi), `rename` onto the target. A
   failing tmp write leaves the target untouched and is reported. All fs calls go through an injectable
   `FsDeps` seam (existing pattern in `pi-agent-settings.ts`) so failure paths are testable.
4. Release in `finally`. Not acquired → `503 { error: "busy" }`, nothing written. A crashed holder's lock
   goes stale after 10 s and is reclaimed by the next locker (pi or dashboard).

`writePiRetryPolicy` and the D1 mirror use the same helper; `PUT /api/pi-retry` gains `busy → 503` and
refuses an unparseable file instead of overwriting it from `{}` (delta on `pi-retry-settings`).

### D6 — Raw editor validation
Route `bodyLimit` 256 KiB → `413`, mapped to the same `{ success:false, error }` envelope as the other
rejections by the route's error handler (no reload; the client keeps the draft dirty). Checked before any write: BOM stripped;
valid JSON; root is a plain object; every D3 key present has its D3 type; `retry` passes a PARTIAL check —
`retry` and `retry.provider`, when present, must be plain objects (not arrays); each PRESENT known field obeys the retry editor's rules (`enabled` boolean;
`maxRetries`, `maxAgentDelayMs`, `provider.maxRetries`, `provider.maxRetryDelayMs` non-negative integers;
`baseDelayMs`, `provider.timeoutMs` positive integers — so raw can never persist a value the retry
editor would then refuse to re-save); absent and unknown fields pass (the full-policy
`validatePiRetryPolicy` is NOT reused — it rejects absent fields); `extensions`, `prompts`, `themes`, `enabledModels`, `defaultTools`, `npmCommand` are arrays of strings;
`skills` is an array of strings OR the legacy plain object pi still migrates; `packages` is an array of strings or objects; `shellPath`, `shellCommandPrefix` are
strings; `modelThinkingLevels` is an object of valid thinking levels. Every other key is NOT
type-checked (scoped guarantee: listed keys only; a wrong unlisted key is pi's to tolerate or reject). Failure →
`400 { errors: [{ field, message }] }`, nothing written. Written text = validated object after D2
substitution, `JSON.stringify(obj, null, 2)` + trailing newline. An unparseable CURRENT file does not
block a raw write (its token is the raw-byte hash) — this is the repair path.

### D7 — Apply to running sessions
After a successful typed or raw write, call the same `reloadConnectedSessions()` dependency the retry
routes use (`server.ts:2266-2278`) and return `reloadedSessions`. Mirror and sync-defaults do NOT
reload: defaults are read only at construction.

### D8 — UI
New `PiSettingsSection.tsx` on Settings → Sessions directly after the Retry section, titled "pi settings
(global)". Segmented control:
- **Form** — D3 fields; read-only default keys labelled "mirrored from Default model"; the D1 drift
  action when values differ.
- **JSON** — Monaco, `language="json"`, whole file; pre-submit warning when the draft changed a
  mirrored key (D2).

ONE draft source via `useSettingsDraftSource` (`page: "sessions"`), holding exactly one mode's draft. No Form↔JSON
conversion of a dirty draft: switching mode while dirty asks discard-or-stay; discard returns to the
last-loaded state. `409` → conflict banner with "Reload from disk" (discards the draft), never
auto-merge. `400` → per-field errors, draft stays dirty. A config save returning `piMirror.ok === false`
shows a non-blocking warning inside the Default Model callout; the save still counts as saved (not a
Save Bar state); a `skipped` mirror shows a non-blocking info notice there. The section states that
saving reloads running sessions, and that it edits the GLOBAL file only — a project
`<cwd>/.pi/settings.json` may override these values at runtime.

## Risks / Trade-offs

- **Bricking pi startup with a bad raw value** → D6 validation; the file is always valid JSON and the
  listed security/startup-relevant keys are type-checked. Unlisted keys are NOT checked (scoped
  guarantee); recovery is another raw edit.
- **pi's own write rejected while the dashboard holds the lock** → critical section limited to
  re-read + compare + replace (D5); pi's failure mode is its existing `ELOCKED` error path.
- **Docker/E2E harness seeds pi's `defaultProvider: "faux"`** (spec `faux-model-integration-tests`) →
  any harness flow that saves a dashboard Default model now rewrites that seed. E2E scenarios that save
  a default model must expect the mirrored value.
- **Code-executing keys editable over the network** (`packages`, `extensions`, `shellPath`,
  `shellCommandPrefix`, `npmCommand`) → behind `networkGuard`, the same guard as `/api/config` and
  `/api/pi-retry`. Equivalent capability already exists with LESS guarding:
  `POST /api/packages/install` (`packages/server/src/routes/package-routes.ts:122`) installs and loads an
  arbitrary npm package under global auth only. No new weaker path; reviewed under
  `security-hardening`. Shape validation (D6) prevents type confusion, not intent.
- **pi's queued flush wins a same-field race** → documented above; reload after write narrows it.
- **Reload interrupts running turns** → same trade-off as the retry editor; stated in the UI.
- **pi changes its lock scheme** → guard test asserts pi's `settings-manager.js` still locks the settings
  path via `proper-lockfile` with `realpath: false` (pattern: subagents' `model-runtime-accessor.test.ts`).

## Migration Plan

None. Additive endpoints and UI. Rollback = revert; files on disk remain valid JSON in pi's shape
(whitespace, key order, and BOM are not preserved by dashboard writes).

## Open Questions

None blocking. The typed key set (D3) can grow later without an API change.
