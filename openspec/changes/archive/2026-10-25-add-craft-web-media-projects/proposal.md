## Why

`extend-craft-web-to-all-apps` (Wave 4, task 5.1) spiked editing FilmCraft and EffectCraft projects in the editor pane. Their project files reference media by in-app virtual paths (`.fcproj`: `"/files/tone.wav"`; `.ecproj`: `"/x"`), so a project opened alone has no media. The spike (2026-10-20, `/tmp/craftweb-spike`, FilmCraft 0.9.0 with the generalized post-install, `load-ready-ms` hook) showed:

- FilmCraft accepts a sequence of synthetic drops: a media drop is imported into the open project as `/files/<name>`, and a later `.fcproj` drop opens a project.
- A saved project names media only by those VFS paths; `collectFiles` needs a folder (desktop only).
- Recovery/autosave write to OPFS and fail in the sandbox (logged, not fatal).
- Whether a project dropped AFTER its media resolves them could not be confirmed: the spike's project was derived from the demo project, so the result was indistinguishable from the demo.
- EffectCraft exposes `window.effectcraft.{addFile, readFile, files}`, a more direct route than drops (needs `?nosw` and the worker trampoline).

Result: no claim ships in `extend-craft-web-to-all-apps`. This change owns the follow-up.

## What Changes

- Spike first, with a project built from scratch (not the demo): push the referenced media (session-cwd confined, size-bounded) before the project, then open the project; for EffectCraft use `addFile`.
- If media resolve: a profile option for host-pushed sibling media (shim: more than one drop per mount; host: resolve and read referenced files under the project folder), FilmCraft/EffectCraft edit claims for `.fcproj` / `.ecproj` with validators, and per-app e2e rows.
- If not: record a no-go and upstream asks (a project-load API that accepts media).

## Capabilities

### Modified Capabilities

- `craft-web-editor`: media-project claims (only after the spike passes).

## Impact

`packages/craft-web-plugin` (profiles, shim, host), possibly core read limits for pushed media. No change ships before the spike result.

## Discipline Skills

- `security-hardening` — host-pushed media are workspace reads driven by a third-party project file (path confinement, size limits).
- `performance-optimization` — media bytes pushed into a sandboxed frame; memory per instance.
