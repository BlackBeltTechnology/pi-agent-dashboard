## Why

`extend-craft-web-to-all-apps` (Wave 4, task 5.1) spiked editing FilmCraft and EffectCraft projects in the editor pane. Their project files reference media by in-app virtual paths (`.fcproj`: `"/files/tone.wav"`; `.ecproj`: `"/x"`), so a project opened alone has no media. The spike (2026-10-20, `/tmp/craftweb-spike`, FilmCraft 0.9.0 with the generalized post-install, `load-ready-ms` hook) showed:

- FilmCraft accepts a sequence of synthetic drops: a media drop is imported into the open project as `/files/<name>`, and a later `.fcproj` drop opens a project.
- A saved project names media only by those VFS paths; `collectFiles` needs a folder (desktop only).
- Recovery/autosave write to OPFS and fail in the sandbox (logged, not fatal).
- Whether a project dropped AFTER its media resolves them could not be confirmed: the spike's project was derived from the demo project, so the result was indistinguishable from the demo.
- EffectCraft exposes `window.effectcraft.{addFile, readFile, files}`, a more direct route than drops (needs `?nosw` and the worker trampoline).

Result: no claim ships in `extend-craft-web-to-all-apps`. This change owns the follow-up.

## What Changes

Spike done 2026-10-25 (details in `design.md` Context):

- **FilmCraft: go.** A from-scratch `.fcproj` resolves its media when they are dropped first and the project names them `/files/<name>`; absolute or relative paths stay offline.
- **EffectCraft: no-go here.** `.ecproj` drops are not opened, and `file.importProject` reports media missing even when the media were added with `addFile`. Upstream ask recorded; no claim.

Scope:

- A profile option for host-delivered media (shim: several drops per mount; client: resolve + read referenced media through `/api/file/raw`, rewrite paths to `/files/<name>` on open, restore them on save).
- A FilmCraft `.fcproj` edit claim with a validator, bounds on media count and size, and per-app e2e rows.
- Modifies the claims table (adds `.fcproj`; `.ecproj` stays unclaimed).

## Capabilities

### Modified Capabilities

- `craft-web-editor`: FilmCraft `.fcproj` claim, media-project open and save requirements.

## Impact

`packages/craft-web-plugin` (profiles, shim, host), possibly core read limits for pushed media. The spike gaps in design.md (sandboxed re-run, save round trip, name collisions) are tasks 1.x and gate the rest.

## Discipline Skills

- `security-hardening` — host-pushed media are workspace reads driven by a third-party project file (path confinement, size limits).
- `performance-optimization` — media bytes pushed into a sandboxed frame; memory per instance.
