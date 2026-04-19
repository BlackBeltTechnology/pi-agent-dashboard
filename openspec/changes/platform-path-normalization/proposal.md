## Why

Filesystem path handling is scattered across the client, server, and shared layers with ad-hoc Unix-style assumptions, causing cross-OS bugs — most visibly in **pin directory**, where paths captured on Windows drift between session `cwd` and pinned-directory storage (mixed separators, trailing separators, drive-letter case), so sessions don't group under their pinned folder. The dashboard already has a `packages/shared/src/platform/` package that owns OS-aware primitives (binary lookup, process spawning, shell detection, subprocess execution); path normalization is conceptually identical and belongs in the same place. Today there is no shared path primitive, and each call site invents its own (incorrect) logic.

## What Changes

- Add a new `packages/shared/src/platform/paths.ts` module that exposes OS-aware path primitives:
  - `normalizePath(p)` — canonicalize separators to the OS-native form, strip trailing separators (except roots), collapse `..` and `.` segments, preserve case as reported by the filesystem when resolvable.
  - `samePath(a, b)` — platform-aware equality (case-insensitive on Windows/macOS-HFS, case-sensitive on Linux), accepting any mix of separators.
  - `parsePathInput(value)` — OS-aware equivalent of today's client-side `parseInput`: splits an in-progress user-typed path into `{ parent, partial }` using the OS's separator, with correct handling of Windows drive letters, UNC paths, and Unix roots.
  - `joinForDisplay(parent, child)` / `withTrailingSep(p)` — small composition helpers used by the path picker.
  - `pathsForSync(p)` — **flag whether a stored path is machine-local** (has drive letter / `~` expansion / realpathed symlink) so downstream code can warn if `preferences.json` is being synced across machines.
- Extend `packages/shared/src/platform/index.ts` to export the new module as a namespace (`paths.*`) alongside `git.*`, `openspec.*`, `npm.*`.
- Migrate call sites to use the new primitives:
  - **Client**: `PathPicker.tsx` (`parseInput` + `descendInto`), `PinDirectoryDialog.tsx` (trailing-separator strip + root fallback), `session-grouping.ts` (map/set lookups become `samePath`-keyed).
  - **Server**: `browser-handlers/directory-handler.ts` `handlePinDirectory` / `handleUnpinDirectory` / `handleReorderPinnedDirs` normalize before `safeRealpathSync`.
  - **Server**: `preferences-store.ts` normalizes on load so pre-existing entries in `preferences.json` migrate forward.
- Document the new module in `docs/architecture.md` and add it to the "Platform primitives" section.

**BREAKING (storage)**: Normalization on load will rewrite entries in `~/.pi/dashboard/preferences.json` the first time the server reads the file with this change present. The on-disk format is unchanged; only the individual string values may change (e.g., `B:\Dev\BB\pi-agent-dashboard\` → `B:\Dev\BB\pi-agent-dashboard`).

## Capabilities

### New Capabilities

- `platform-paths`: OS-aware path normalization, comparison, and user-input parsing primitives. Lives in `packages/shared/src/platform/paths.ts` alongside other platform primitives. This is the canonical answer to "how do we compare / normalize / display filesystem paths" across the whole dashboard.

### Modified Capabilities

- `directory-path-display`: Session grouping and pinned-directory rendering use the new `samePath` primitive for equality, so sessions with drift in separator / case / trailing slash group under their pinned folder. Today's exact-string match in `groupSessionsByDirectory` becomes `samePath`-keyed.

## Impact

- **New module**: `packages/shared/src/platform/paths.ts` (+ tests) + `packages/shared/src/platform/__tests__/platform-paths.test.ts`.
- **Modified files**:
  - `packages/shared/src/platform/index.ts` — add `paths.*` namespace export.
  - `packages/client/src/components/PathPicker.tsx` — replace inline `parseInput` / separator handling with `paths.parsePathInput` + `paths.joinForDisplay`.
  - `packages/client/src/components/PinDirectoryDialog.tsx` — replace Unix-only trailing-slash strip with `paths.normalizePath`.
  - `packages/client/src/lib/session-grouping.ts` — replace `Map<string>` / `Set<string>` lookups with `samePath`-keyed helpers.
  - `packages/server/src/browser-handlers/directory-handler.ts` — normalize on pin / unpin / reorder before storage.
  - `packages/server/src/preferences-store.ts` — normalize on load (and deduplicate post-normalization).
  - `docs/architecture.md` — add a "Path handling" subsection under "Platform primitives".
- **Dependencies**: Uses only `node:path` and `node:fs` — no new deps.
- **Platforms**: Fixes observable cross-OS pin-directory bugs on Windows; no behavior change on macOS/Linux beyond equality becoming tolerant of trailing-separator / case drift (tolerance that matches OS semantics).
- **Risk**: Medium. Touches the UI path-picker component and the session-grouping map keying — both are user-visible. Mitigated by (a) the primitive being pure and fully unit-tested, (b) a one-time normalize-on-load for existing preferences, (c) no wire-format change.
- **Supersedes**: This is the canonical home for path-handling primitives going forward. Any future OS-path-related work (symlink behavior, UNC paths, drive-letter normalization, macOS `/private` prefix handling) extends this module rather than re-inventing per-call-site.
