## Context

See proposal.md (Why). Current state the design builds on:

- **Embedded apps.** They mount through `shell-overlay-route` claims with `presentation: "content"` and `<EmbeddedApp>` (`packages/dashboard-plugin-runtime/src/embedded-app.tsx`; `docs/plugin-apps.md`).
- **Folder gating today.**
  - Only `predicate` gates folder slots. `forFolder` filters by it alone (`packages/dashboard-plugin-runtime/src/slot-registry.ts:249-251`), and `shouldRender` is not applied there.
  - `forFolder` is called by `SidebarFolderSectionSlot` and `WorktreeCardSectionSlot` (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx:140-180`). Neither calls `useSlotClaimsVersion()`, unlike the session gate wrappers (`slot-consumers.tsx:45,58,75,89`), so today a bump does not re-render folder entries.
  - `ShellOverlayRouteSwitch` matches by path only, with no predicate. A deep link therefore reaches any folder.
- **Predicate wiring.**
  - Predicates must be synchronous. Codegen imports them as named exports of the plugin client entry (`packages/dashboard-plugin-runtime/src/vite-plugin/index.ts:349-350`), and a missing export fails the build (`:308-318`).
  - Late signals re-render gates via `bumpSlotClaimsVersion()` (`packages/dashboard-plugin-runtime/src/slot-claims-invalidation.ts:44`).
  - Reference module caches: `packages/blackhole-plugin/src/client/installed-gate.ts` and `packages/client/src/hooks/usePluginEnabledSet.ts:60-66`. The latter applies the enabled set and bumps on every refresh.
- **Folder menu items.** `useFolderMenuItem(scope, contribution)` (`packages/dashboard-plugin-runtime/src/folder-menu-contributions.tsx:252`) is called from inside a folder-section component (e.g. `packages/goal-plugin/src/client/FolderGoalsSection.tsx:36`). A predicate that hides the section therefore also suppresses its menu items.
- **Folder route admission.**
  - `admitCwd(cwd, known)` (`packages/shared/src/cwd-guard.ts:405`) is the shared tri-state guard: admit, refuse, or indeterminate → 503. It has a global cap, a deadline and in-flight de-dup, and it never prompts.
  - `GET /api/file/exists` (`packages/server/src/routes/file-routes.ts:790-830`) adds `holdDenial` → `resolveCwdVerdict` (`file-routes.ts:1470-1482`; `packages/server/src/access/cwd-verdict.ts:82`). That can raise an operator prompt, which a background sidebar fetch must not do.
- **Manifest validation and plugin state.**
  - `validateManifest` (`packages/dashboard-plugin-runtime/src/manifest-validator.ts:356`) does not reject unknown top-level fields. Its return literal (`:541-556`) whitelists known fields, so a new field must be added there to survive discovery.
  - Manifests come from `discoverPlugins()` (`packages/dashboard-plugin-runtime/src/server/loader.ts:118`). Enabled state comes from `resolvePluginEnabled` (`packages/dashboard-plugin-runtime/src/server/plugin-enabled.ts:25`) over the plugin config.
- **Existing identities.** Nothing in `packages/` reads a project identity file or defines a folder type. The team plugin keeps a private `projects.json` (`packages/team-plugin/src/server/projects.ts`), and `project-init` has profiles (`packages/extension/src/project-init/profiles.ts`). Neither is touched.

## Goals / Non-Goals

Goals: one core source of truth for "what project is this folder", cheap enough to evaluate for every folder in the sidebar, and usable by any plugin with one exported line.

Non-goals (design level):
- Server-side caching or file watching of project identity.
- Gating `shell-overlay-route` by predicate in the registry.
- Gating session-scoped slots.
- Scoping standalone `/apps/<id>/` hosts.

## Decisions

### D1. Identity = declared file + plugin marker rules, declared wins
`.pi/dashboard/project.json` is explicit, deterministic and travels with the repo. It supplies the `id` (detection never infers one) and an optional `type`. It lives in the dashboard's own `.pi/dashboard/` namespace (alongside `knowledge_base.json`) so a future pi core file cannot collide with it. Marker rules make existing repos work without editing them. Fields validate independently, so one bad field does not discard a good one.

*Alternatives:*
- `.pi/project.json`: it collides with the pi core namespace.
- Declared only: it forces edits to every repo.
- Markers only: no stable id.
- A core rule registry in config: it splits type knowledge away from the plugin that understands the type.

### D2. Rules live in the plugin manifest, evaluated server-side for enabled plugins only
The plugin that ships the app knows its type's markers. Evaluating server-side keeps filesystem access behind one admission point. Disabling a plugin retracts its type. `projectTypes` is added to `PluginManifest` and to the validator's return whitelist.

*Alternative:* client-side checks via a generic file-exists route. That costs N requests per folder and goes through a prompting admission path.

### D3. Restricted marker grammar, bounded symlink-free walk
The grammar is pinned in the `dashboard-plugin-loader` delta. It is root-anchored, at most 3 segments, with `*` inside a segment only, no `.git` or `node_modules` segments, and a literal character in the last segment. The walk works as follows:

- **Single pass.** One walk per resolution, driven by a trie of all patterns' segments, descends only into directories some pattern can still match.
- **Early stop.** It reads directories with `fs.promises.opendir` and an incremental `read()`, decrementing a shared 2000-entry budget and stopping early.
- **No symlinks.** `Dirent.isSymbolicLink()` entries are neither matched nor descended, so there is no escape from the folder. `.git` and `node_modules` are skipped by name.
- **Pattern budget.** At most 256 patterns are evaluated, taking plugins in (priority, id) order (the same order as claims) and skipping whole plugins that do not fit. Matching cost is therefore at most 2000 × 256 cheap segment matches per request.
- **Deadline.** Each resolution has a 2 s deadline. On expiry it aborts, releases its slot and returns `truncated: true`, so a hung network mount cannot hold a slot forever.
- **Plugin set.** Rules come only from plugins that are loaded, enabled and pass `fixtureEntryAllowed` (`fixture-gate.ts:21-25`). Skipping any plugin for budget sets `truncated`.
- **Global walk cap.** A process-wide semaphore allows at most 4 concurrent walks. A sidebar with many folders queues walks instead of thrashing the disk; the per-request budget times the cap bounds total in-flight I/O.
- **Short-circuit.** No enabled rules → no walk.

*Alternative:* a glob library. It is unbounded, follows symlinks by default, and adds a dependency.

### D4. Endpoint `GET /api/folder/project` in a new route module
New module `packages/server/src/routes/folder-project-routes.ts`, registered in `server.ts` with `{ preHandler: networkGuard }` like the file routes.

**Admission.** The route calls `admitCwd(cwd, known)`, where `known` lists session cwds plus pinned directories. Refuse → 403, indeterminate → 503 with `Retry-After`. It deliberately never calls `holdDenial` and never prompts.

**Ordering.** `admitCwd` runs first. It refuses missing-and-unknown paths, so a `stat` after admission yields `404` only for admitted-but-deleted folders. The in-flight de-dup key is the raw `cwd` string after admission, so no fs access happens before admission. The 503 body reuses the `plugin-cwd-admission` shape. `admitCwd` gets the existing `cwdAdmissionLogger` as `onIndeterminate` (as `server.ts:3430` does), so indeterminate admissions log at warn level, rate-limited, per that spec. The route gets an `observe` row in `packages/shared/src/route-tiers.ts` (as `/api/file/exists` at `:95`); the completeness test fails without it.

**Reading the declaration.**
- `lstat` each of `.pi`, `.pi/dashboard` and `project.json`. Any symlink, or a non-regular file, means absent.
- Then `open` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (flags guarded where undefined, e.g. Windows) → `fstat` on the descriptor (must be a regular file, ≤ 64 KiB) → read at most 64 KiB + 1 bytes → `JSON.parse`. `O_NONBLOCK` keeps a swapped-in FIFO from blocking a threadpool thread.
- After opening, the reader re-`lstat`s `.pi` and `.pi/dashboard` and compares `dev`/`ino` with the first pass. A mismatch means absent, which closes the parent-swap read escape.
- Keep only known fields of a plain object, so prototype keys are ignored. Growth past the cap is detected by the extra byte.

**Concurrency.** Simultaneous requests for one cwd share one in-flight promise. Walks additionally queue on the global walk cap (D3).

**Rule freshness.** Rules come from `discoverPlugins()`, which caches for the process lifetime. Installing or updating a plugin already requires a restart (the Plugins section's restart-required banner), so rules are as fresh as the loaded plugin set. Enable/disable is read per request via `resolvePluginEnabled`.

**Containment.** `file-read-containment` governs routes that resolve a caller-supplied file path. This route takes only a cwd, reads fixed names under it and follows no symlinks, so it is not a new containment site (a verified false positive of the collateral scan).

### D5. Client cache + predicate factories in the runtime
New module `packages/dashboard-plugin-runtime/src/folder-project.ts`, exported from the runtime root:

- `useFolderProject(cwd)` (via `useSyncExternalStore`) and `getFolderProject(cwd)`.
- `invalidateFolderProject(cwd)` and `clearFolderProjects()`.
- `folderHasProjectType(type)` and `folderHasProjectId(id)`, typed on `FolderDescriptor`.

Behaviour:

- **Entry states.** Entries are `loading | ready | error`, and an `error` entry carries an expiry 60 s ahead.
- **Cache miss.** The predicate adds the cwd to a module-level pending set; this is no React state update during render. A `queueMicrotask` flush issues the fetches. Landings in one flush cause one `bumpSlotClaimsVersion()`, error landings included.
- **Error expiry.** An `error` entry arms a 60 s timer. On expiry the entry is dropped and the version bumped, so the predicate re-runs and refetches without any unrelated render.
- **Generations.** Each folder entry has its own generation. `invalidateFolderProject(cwd)` advances that folder's generation, and `clearFolderProjects()` advances all of them. A landing from an older generation is discarded and its folder re-queued, so a response computed under a disabled plugin's rules cannot repopulate the cache, and invalidating one folder never strands another in `loading`.
- **Plugin set changes.** `usePluginEnabledSet` calls `clearFolderProjects()` only when the new enabled set differs from the previous one.
- **Single runtime instance.** This relies on host and plugins resolving one runtime module instance, the same assumption the invalidation store documents (`slot-claims-invalidation.ts` header). A duplicated runtime yields always-false predicates.

**Why `predicate`, not `shouldRender`.** "Is this folder a JUDO project" is structural targeting; the async fetch is only how the answer is obtained. More decisively, `forFolder` does not apply `shouldRender`. Using `predicate` avoids changing the folder filter contract. The required re-render on bump is added by the `dashboard-shell-slots` delta.

*Alternative:* the sidebar pre-fetches every folder's project. That fetches even when no plugin uses the feature.

### D6. `EmbeddedApp` `projectScope` closes the folder-route deep link
Gating `shell-overlay-route` in the registry would change a shipped matching contract shared with core descriptors (`back-target.ts` specificity). Instead:

- `<EmbeddedApp>` calls `useFolderProject(projectScope ? cwd : undefined)` before its existing early returns, so hook order stays stable and an unscoped app never fetches. It mounts the app only on a `ready` match.
- Otherwise it renders the new `not-available` state, alongside the existing `folder not found` state. The usual top bar still renders, so the shipped top-bar requirement holds, with a message and Back via the claim's `onBack`.
- The scaffold passes no `standaloneUrl` for scoped apps and emits no standalone entry. The shipped *Open standalone* rule (shown only when a `standaloneUrl` is passed) stays unchanged.
- The `AppHost` interface is unchanged.

Shadowing: `ShellOverlayRouteSwitch` renders the first path match in (priority, id) order, and duplicate-path checks are per plugin only (`manifest-validator.ts:523-534`). Two plugins claiming the same folder app path already shadow each other today. This change neither introduces nor fixes that; scoped paths are namespaced by app id (`/folder/:encodedCwd/<appId>/*?`).

### D7. Scaffold skill extends mode `new` inside the single batch
The shipped "Two modes selected by the up-front batch" stays intact. The scope, type/markers, id and optional target-folder questions join the batch. Invalid input is reported and the skill stops; there is no re-ask round. The identity-file write runs after the existing final summary confirm. It refuses, rather than prompting again, on a different existing id, a `schemaVersion` other than 1, a symlink, an oversized file or an invalid file, and it writes via temp file + rename.

Generation lives in `packages/dashboard-plugin-skill/src/render.ts` and `src/templates/*.tmpl`, tested by `src/__tests__/render-new.test.ts`. `requiredApi` stays `"^0.x"` (forward-compat contract item 5). Nothing enforces it today, and plugin clients are compiled into the dashboard's own build against the same runtime, so a scoped plugin cannot run on a runtime lacking the new exports. A mismatch fails the build, not open. Templates derive from `packages/demo-plugin/src/demo-app/`, and the folder entry is a state-only pill per `plugin-embedded-app`.

### D8. Reference consumer = an additional scoped demo app
`demo-plugin` gains a second, project-scoped app claim (`/folder/:encodedCwd/demo-scoped/*?`, type `demo-scoped`, marker `.pi/dashboard/demo-scoped`). Its existing ungated demo app and claims stay unchanged, so scaffold fixtures and e2e assumptions hold.

## Risks / Trade-offs

- **Folder entries pop in after the first sidebar render** → accepted; this is the same behaviour as `installed-gate`.
- **A stale cache after the user edits the identity file** → `invalidateFolderProject(cwd)` is exported, and the cache clears on plugin-set change and page reload. A file watcher is deferred.
- **Worktrees and clones inherit a committed `id`** → intended. A worktree of `acme-erp` is `acme-erp`, and project-specific apps show on its worktree cards too.
- **Two "project" notions exist (team-plugin project slugs vs. folder identity `id`)** → accepted. They are independent namespaces. Docs state that the folder identity `id` is declared by the repo, while team projects are admin config.
- **Marker rules from a plugin probing paths** → plugins already run with full trust (README trust model). Walks are folder-confined, symlink-free and admitted-cwd only, and responses return type names, never paths.
- **Huge trees** → the 2000-entry bound plus `truncated`; a deep marker may be missed, and declaring `type` resolves that.
- **Symlink swap races** → the identity read is closed by `O_NOFOLLOW` plus the parent `dev`/`ino` re-check. In the marker walk, a directory swapped for a symlink between `readdir` and `opendir` is caught the same way: `lstat` before and after `opendir`, comparing `dev`/`ino`, and skipping the directory on mismatch. The residual is a swap after the check and before the read, by someone who can already write the repo. It discloses at most whether a marker-shaped name exists, reduced to a type name; no file content is read during the walk.
- **Declared `id` is unauthenticated** → any repo can declare `"id": "acme-erp"` and get that app's entry. The app still runs against the admitted folder it is opened in, so this is spoofed context, not cross-folder data access. Docs state that project-scoped apps must not grant privileged data by `id` alone; data stays bound to the admitted cwd.
- **Worktree card gap** → `SessionCard.tsx:1487-1490` renders a spacing wrapper around `WorktreeCardSectionSlot` even when it is empty. This is pre-existing and unchanged.
- **External plugins and runtime skew** → plugin clients are compiled into the dashboard build against its runtime, so a missing export fails the build rather than silently ungating.

## Migration Plan

Additive, with no data migration. Deploy order: shared types → runtime → server route → demo/skill/docs.

Rollback: revert this change. The only in-repo consumer (the demo scoped app) is part of it. External scoped consumers fail the dashboard build until removed. Leftover `.pi/dashboard/project.json` files are inert.
