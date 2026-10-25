## Context

Spike 2026-10-25 (`/tmp/mp-spike`, pristine builds, unsandboxed, synthetic drops via Playwright; FilmCraft 0.12.0, EffectCraft 0.16.0). The project was built from scratch with `pi-craft filmcraft exec --save-as p.fcproj import clip.mp4` (not the demo project).

**FilmCraft — go.**
- `.fcproj` is JSON (`format: filmcraft.project`, `schema_version: 15`). Media sit at `project.items[*].kind.Media.media.File.path`; the CLI writes the absolute disk path (`/private/tmp/mp-spike/clip.mp4`).
- Dropping `clip.mp4` then the project: with path `/files/clip.mp4` the item resolves (thumbnail, duration 0:02, "1 items"); with the absolute path or bare `clip.mp4` the engine logs `media offline: … not found (files from an earlier browser session must be imported again)`.
- A media drop is imported to the VFS as `/files/<file name>`. The 0.12.0 glue exports only `start` (no `addFile`), so drops are the only route; the earlier doc claim of `window.filmcraft` in 0.12.0 is wrong (`docs/craft-web-plugin.md` rows 533–534).

**EffectCraft — no-go for this change.**
- Dropping `.ecproj` only stores it in the VFS; it does not open. `window.effectcraft.execute("file.open", {path})` opens it.
- With the media added by `addFile("/clip.mp4")` first, `file.importProject` still reports `missingMedia` for both `clip.mp4` and `/clip.mp4` paths. No path form was found that resolves. Upstream ask: a project-load API that takes media, or documented footage path resolution against the VFS.

**Not covered by the spike (verified by tasks, not assumed):** behaviour inside `sandbox="allow-scripts"` with the real shim, the save round trip of `.fcproj` through the shim, name collisions between media in different folders.

**Implementation spike (2026-10-25, real post-install + shim v4 + production CSP + `sandbox="allow-scripts"`, FilmCraft 0.12.0; tasks 1.1-1.3).** Two media named `a.mp4` from different folders were delivered one at a time; each ack arrived ~0.5 s after its drop (the first after the 3 s title-less gate); both came up online (0:02 and 0:03) as `a.mp4` and `2-a.mp4`; the project opened with `opened{confirmed:false}`. Ctrl+S produced a `save` whose bytes name `/files/a.mp4` and `/files/2-a.mp4`; restoring gave back the original path strings and an otherwise identical project. Recovery/autosave to OPFS fails in the sandbox (logged, not fatal). The only CSP report was the favicon (`img-src`), as for every other app.

## Goals / Non-Goals

Goals: open a `.fcproj` from the workspace in FilmCraft with its media online; save back to the same file with paths as the user's tool expects.
Non-goals: EffectCraft claim; editing media; writing media back; media outside the project's session cwd; `.fcprojx`/other FilmCraft formats.

## Decisions

**D1 — Host rewrites paths; the app is never given a disk path.** On open the client parses the `.fcproj` and reads `project.items[*].kind.Media.media.File.path` by explicit access only (`JSON.parse`, no recursive walk or merge; the vfsName→original map is a `Map`; `__proto__`/`constructor` keys are inert). The project file is capped at 16 MiB. Each referenced medium is resolved (D2), delivered as a drop before the project, and its path in the delivered bytes replaced with `/files/<vfsName>`. A path that cannot be delivered is left unchanged, so FilmCraft shows it offline; the user is told how many are missing.

**D2 — Media are confined to the project's own folder.** A third-party project file must not become a read oracle over the repository, so the plugin does not use the full `/api/file/raw` posture (cwd + git common root + operator grants, `packages/server/src/routes/file-routes.ts:1242`). It normalises each path (relative → against the project's directory; absolute → only if under the project's directory) and requests it only when the normalised cwd-relative path stays inside the project's directory subtree (no `..` escaping it). Symlinks are the gate's concern: the request still goes through `/api/file/raw?cwd&path` (network guard + containment), as a new caller following the pattern at `packages/client/src/components/editor-pane/file-handler/file-handler-host.ts:105-115`, with its own bounds (D5). A project that references media outside its folder (e.g. `../footage/a.mp4`) shows them offline; accepted trade-off, revisit only on demand.

**D3 — VFS names are unique per open.** FilmCraft names media by file name, so two media with the same base name in different folders collide. The host assigns `<n>-<basename>` when a name repeats and records the map `{vfsName → original path string}`.

**D4 — Save restores original path strings, at a named point.** `FrameSession.routeAndSave` (`packages/craft-web-plugin/src/client/frame-session.ts:384`) is the only place saved bytes pass before `workspaceSave` (`:499`). For a media project it parses the saved JSON, maps each `/files/<vfsName>` found in the delivered-media map back to the exact original string, and hands the result on; the validator stays reject-only and runs afterwards on the final bytes. No file can enter the app except through the host's media drops (the isolation requirement refuses chooser, picker, drops and file paste), so every `/files/<name>` in saved bytes is in the map; one that is not (unexpected app behaviour) is left unchanged and the save proceeds. Undelivered media keep their original path string unchanged, so a save never loses a reference. Validator: `.fcproj` entry in `packages/craft-web-plugin/src/server/validators/` (JSON, `format` = `filmcraft.project`, `schema_version`, `project` object), reject-only.

**D5 — Bounded and sequential.** Project ≤ 16 MiB; per medium ≤ 64 MiB; per project ≤ 256 MiB and ≤ 64 files (profile fields `mediaMaxBytes`, `mediaMaxTotalBytes`, `mediaMaxFiles`, checked by `profile-checks.ts`). Media are read, transferred and acknowledged one at a time: the client holds at most one medium's buffer, releases its reference after the ack, and the app keeps its own copy (so frame memory grows with the total). With `keepAlive {max:3}` three max-bound instances could hold ~768 MiB, so an e2e row opens two concurrent max-bound projects and measures; the total is lowered if that fails. Media are taken in document order of first reference, so which ones survive a bound is deterministic.

**D6 — Shim takes N drops with an acknowledgement.** The shim handles one `open` today (`openHandled`, `packages/craft-web-plugin/src/shim/craft-shim.js:253-257`). A new `open-media` message delivers one medium as a synthetic drop through the same `ownDrop` path (`:145`, `:278-298`); the opened-fallback timer (`craft-shim.js:299`) is armed only by the project `open`, never by `open-media`, so a media drop cannot report the document opened. The shim answers `open-media-ack {name}` after its own settle delay; the next medium or the project `open` is sent only after the ack. `SHIM_VERSION` (`:43`) is bumped and FilmCraft's `minShimVersion` raised; apps without `mediaProject` never receive `open-media`.

**D7 — Opt-in per profile.** `CraftAppProfile.mediaProject?: { format: "fcproj"; … }`; only FilmCraft sets it. Other apps behave exactly as today.

## Risks / Trade-offs

- Rewriting project bytes means the saved project differs from the user's tool's output if the app reorders JSON; accepted, since the file is the app's own format.
- A drop of media sits in app memory (≤ 256 MiB on top of the wasm heap); mitigated by D5 and by `keepAlive max:3` being unchanged — to be measured in the e2e row.
- If the app changes how `/files/` paths resolve in a later release, the e2e row (real FilmCraft) fails loudly; the profile pins the verified version.

## Migration / Rollback

No data migration. New optional profile fields and a new shim message; FilmCraft claim added. Rollback: remove the FilmCraft claim (the handler disappears); the shim change is backward compatible. Existing saved `.fcproj` files are never modified except by the user saving in the editor.

## Open Questions

- Does a sandboxed frame still resolve `/files/` after the real shim's drops, each landing before the next (task 1.1)?
- Does FilmCraft's save emit paths in a form the reverse map covers (task 1.2)?
- Cross-spec clearance (`craft-app-skills`, `craft-binary-provisioning`, `craft-cli-entrypoint`, `plugin-runtime-client-loading`) was scanned, not verified in full; re-check at implementation.
