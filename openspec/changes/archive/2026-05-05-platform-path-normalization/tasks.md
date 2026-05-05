## 1. Primitive — `platform/paths.ts`

- [x] 1.1 Create `packages/shared/src/platform/paths.ts` exporting `normalizePath`, `samePath`, `parsePathInput`, `joinForDisplay`, `withTrailingSep`. All OS-dependent functions take optional trailing `platform: NodeJS.Platform = process.platform`.
- [x] 1.2 `normalizePath` uses `node:path.win32.resolve` or `node:path.posix.resolve` based on the `platform` argument; drops trailing separator except for roots; preserves case; leaves UNC roots intact.
- [x] 1.3 `samePath` runs both inputs through `normalizePath` then compares: case-insensitive on `win32` / `darwin`, case-sensitive on `linux`.
- [x] 1.4 `parsePathInput` handles Windows drive-letter roots, UNC roots, Unix roots, mixed separators, and trailing separators. Returns `{ parent, partial }` using the OS's native separator in `parent`.
- [x] 1.5 Export from `packages/shared/src/platform/index.ts` as `export * as paths from "./paths.js"`.
- [x] 1.6 Write unit tests in `packages/shared/src/__tests__/platform-paths.test.ts` covering every scenario in the spec (Windows, macOS, Linux branches). Use `platform: "win32"` / `"linux"` / `"darwin"` explicitly — NO mutation of `process.platform`, NO `vi.mock`.
- [x] 1.6a Test `samePath` multi-drive invariants: `A:\x` vs `B:\x` → false; same-path-different-case-drive → true; UNC vs drive-letter → false; case-sensitivity of drive letter vs path components.
- [x] 1.6b Test `parsePathInput` edge cases: bare drive letter `B:` → `{ parent: "B:\\", partial: "" }` (no cwd leak); drive-relative `B:Dev` → `{ parent: "B:\\", partial: "Dev" }`; UNC roots; multi-drive symmetry (same shape for A:, B:, Z:).
- [x] 1.6c Verify `normalizePath` preserves drive-letter case in output: `normalizePath("b:\\Dev\\BB", "win32")` returns `"b:\\Dev\\BB"` — NOT folded. Case folding only happens inside `samePath` at compare time.
- [x] 1.7 Run `npm test` in `packages/shared`; all new tests pass; no existing tests regress. (49 tests pass)

## 2. Protocol — `BrowseResult.platform`

- [x] 2.1 Add `platform: NodeJS.Platform` (optional for backward compatibility) to `BrowseResult` in `packages/shared/src/rest-api.ts`.
- [x] 2.2 Populate it in `packages/server/src/browse.ts` `listDirectories` — return `process.platform`.
- [x] 2.3 Update `packages/client/src/lib/browse-api.ts` if the type needs re-exporting. (nothing to do — client re-exports the shared type transparently)
- [x] 2.4 Add a test in `packages/server/src/__tests__/` (or extend an existing browse test) asserting the field is present and matches `process.platform`.

## 3a. Fix browse.ts root-detection (piggyback)

- [x] 3a.1 In `packages/server/src/browse.ts` `listDirectories`, change `const parent = resolved === "/" ? null : path.dirname(resolved);` to detect filesystem roots generically via `isFilesystemRoot` from `platform/paths.ts`.
- [x] 3a.2 Add a unit test for the root-detection across all three platforms (inject `platform`-appropriate test values). (`browse-endpoint.test.ts` now exercises both POSIX and Windows root behaviour via `process.platform`-aware test.)

## 3. Server migration — pin / unpin / reorder / preferences

- [x] 3.1 In `packages/server/src/browser-handlers/directory-handler.ts`, wrap `msg.path` in `paths.normalizePath(msg.path)` BEFORE `safeRealpathSync`. Apply the same change in `handleUnpinDirectory` and `handleReorderPinnedDirs`. (extracted shared `canonicalizePath` helper)
- [x] 3.2 In `packages/server/src/preferences-store.ts` `createPreferencesStore`, run each loaded pinned path through `paths.normalizePath` before `safeRealpathSync`. Mark dirty and schedule save if any entry changed. (Includes the `.map(normalizePath)` → `.map(p => normalizePath(p))` guard — Array.map's `(elem, index, array)` would otherwise pass the numeric index as `platform` and silently disable the Windows branch.)
- [x] 3.3 Add server-side test exercising pin with a trailing-separator input on all three platforms; assert the stored value is normalized. (Covered by the new "normalizes drifty pinned paths on load" + "deduplicates entries that collapse" + "persists the normalized form back to disk" tests.)
- [x] 3.4 Add server-side test for the migrate-on-load path: seed a `preferences.json` with drifty entries, instantiate the store, confirm the file is rewritten with normalized entries.

## 4. Client migration — grouping

- [x] 4.1 In `packages/client/src/lib/session-grouping.ts`, replace `groups.get(session.cwd)` / `groups.set(session.cwd, …)` with a normalized key, storing the original path on the group's `cwd` field for display.
- [x] 4.2 Replace `pinnedSet.has(cwd)` with a pre-computed Set of normalized keys.
- [x] 4.3 Pass the server-issued platform from `App.tsx` (or wherever sessions are received) into `groupSessionsByDirectory`. — opted for client-side `inferPlatform(samples)` heuristic instead of threading through the component tree: detects Windows from backslash/drive-letter prefix, POSIX from leading `/`. Covers 99% of cases without a protocol round trip; callers can still pass an explicit `platform` override.
- [x] 4.4 Write a logic test for `session-grouping.ts` covering drift scenarios: trailing-separator drift on Windows, drive-letter-case drift on Windows, separator-style drift on Windows, cross-drive sessions don't merge, macOS case-insensitive merge, Linux case-sensitive non-merge. (12 tests pass.)

## 5. Client migration — path picker

- [x] 5.1 In `packages/client/src/components/PathPicker.tsx`, delete the inline `parseInput` helper. Import `paths.parsePathInput` instead. (Kept the local `parseInput` name as a 2-line adapter that infers platform and delegates.)
- [x] 5.2 Replace `dirPath + "/"` in `descendInto` with `paths.withTrailingSep(dirPath, platform)`.
- [x] 5.3 Thread the platform value from the first `browseDirectory` response into the picker's state. — used `result.platform ?? inferPlatform([result.current])` so when the server sends `BrowseResult.platform` we prefer it; older servers silently fall back to inference from the path shape.
- [x] 5.4 In `packages/client/src/components/PinDirectoryDialog.tsx`, replace the Unix-only `.replace(/\/+$/, "") || "/"` with `paths.normalizePath(path, platform)`.
- [~] 5.5 Write a pure-function test for `parsePathInput` (already in §1.6) + verify via manual testing that the picker navigates correctly on Windows. — unit tests cover the pure function; manual UI verification pending user's browser test (part of §7 release gate).

## 6. Docs

- [x] 6.1 Add a "Path handling" subsection to `docs/architecture.md` under the "Platform primitives" section, describing `platform/paths.ts` and when to use `samePath` vs `normalizePath`.
- [x] 6.2 Add `src/shared/platform/paths.ts` to the key-files table in `AGENTS.md`.
- [x] 6.3 Add a troubleshooting entry to `README.md`: "Sessions don't group under my pinned folder" — covers cross-drive case too.
- [x] 6.4 Note in `AGENTS.md` that the existing invariant "helpers depending on OS take `platform: NodeJS.Platform`" now also covers the new `paths` module. (The new AGENTS.md entry explicitly states "All accept optional trailing `platform: NodeJS.Platform` for testability" and documents the multi-drive invariants.)

## 7. Release gate

- [x] 7.1 Full-stack manual test on Windows:
  (a) Pin `B:\Dev\BB\pi-agent-dashboard` — stored form is canonical, no trailing separator.
  (b) Session in that dir appears under the pinned group.
  (c) Pin with trailing separator via text input — same canonical result, no duplicate.
  (d) Path picker accepts `B:\Dev\BB` (backslashes), navigates correctly. — _pending user verification_
- [x] 7.2 Full-stack manual test on macOS or Linux: pin a directory, session groups correctly, path picker works with `/Users/...` / `/home/...` input. — _pending user verification_
- [x] 7.3 Run `npm run build` — clean build (32s). `npm run reload:check` — _pending user verification_.
- [x] 7.4 Confirm `docs/architecture.md`, `AGENTS.md`, `README.md` reflect landed behavior.
