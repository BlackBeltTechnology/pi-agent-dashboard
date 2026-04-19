## Context

Path handling in the dashboard is currently spread across three layers:

```
 client                         server                        shared
 ─────                          ──────                        ──────
 PathPicker.tsx                 directory-handler.ts          (nothing)
   parseInput() — Unix-only       safeRealpathSync() + raw
   descendInto() — "/" append     string store

 PinDirectoryDialog               preferences-store.ts
   .replace(/\/+$/, "") || "/"    raw-string equality

 session-grouping.ts              browse.ts
   Map<string>, Set<string>        uses node:path correctly
   exact match by raw cwd          (good example)
```

Every site makes its own implicit assumptions. On Windows, the effects are visible in pin-directory: a session's `cwd` might arrive as `B:\Dev\BB\pi-agent-dashboard` while a pinned entry is stored as `B:\Dev\BB\pi-agent-dashboard\` or `B:\Dev\BB\pi-agent-dashboard/`, and the client's exact-string match drops them into separate groups.

The `packages/shared/src/platform/` package already solves exactly this problem class for *binaries* (`binary-lookup.ts` — OS-aware PATH search with PATHEXT on Windows), *processes* (`process.ts` — netstat/lsof/taskkill abstractions), and *shells* (`shell.ts` — `detectShell()` across platforms). Adding a `paths.ts` module is a direct continuation of that pattern.

### Reference implementation already nearby

`packages/server/src/browse.ts` already uses `node:path` correctly:

```ts
import path from "node:path";
const parent = resolved === "/" ? null : path.dirname(resolved);
```

That's the level of correctness we want *every* caller to have, via a shared helper.

## Goals / Non-Goals

**Goals:**

- One module owns every path primitive the dashboard uses for user-visible paths.
- Platform-correct equality (`samePath`) — Windows/macOS-HFS case-insensitive, Linux case-sensitive.
- Platform-correct input parsing (`parsePathInput`) — works for Windows drive letters (`C:\`), UNC paths (`\\server\share`), and Unix absolute paths (`/`).
- Pin/unpin, session grouping, path picker all use the shared primitive; no caller invents its own.
- One-time migration on preferences load — old stored paths get normalized in place.
- Fully unit-tested with platform injection (no `process.platform` mutation in tests).

**Non-Goals:**

- Not a general-purpose path manipulation library. We expose the minimum surface the dashboard actually needs today; additions are by explicit spec change.
- Not changing the server's `browse.ts` — it's already correct. Leaving it alone.
- Not implementing cross-machine path portability (translating Windows paths on macOS). Machine-local paths stay machine-local. The `pathsForSync` helper is a diagnostic flag, not a translator.
- Not replacing `safeRealpathSync` — realpath is orthogonal to normalization and stays where it is.
- Not a refactor of every path string in the codebase — scope is pin-directory + session-grouping + path picker, which is where users hit bugs today. Additional migrations can follow.

## Decisions

### 1. Module lives at `packages/shared/src/platform/paths.ts`

Follows the existing platform-primitives convention. Exported from `platform/index.ts` as a namespace (`paths.normalizePath(...)`, `paths.samePath(...)`) alongside `git`, `openspec`, `npm`. This keeps the dashboard's "OS-aware stuff" visually unified.

**Alternative considered:** put it at `packages/shared/src/paths.ts` (outside `platform/`). Rejected — path handling is exactly what the platform namespace is for; splitting it out fragments the mental model.

### 2. Primitives take an injectable `platform: NodeJS.Platform` argument (default = `process.platform`)

Mirrors the pattern already used by `packages/shared/src/platform/commands.ts` (`openBrowser`, `isVirtualMachine`) and `platform/process-scan.ts`. Tests exercise both Windows and Unix branches by passing `"win32"` or `"linux"` explicitly — no `vi.mock` of `process.platform`.

```ts
export function normalizePath(p: string, platform: NodeJS.Platform = process.platform): string;
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean;
export function parsePathInput(value: string, platform: NodeJS.Platform = process.platform): { parent: string; partial: string };
```

This is the established test-friendly idiom in the platform package. Documented invariant in `AGENTS.md` already: "All exported helpers that depend on OS take an optional `platform: NodeJS.Platform` parameter."

### 3. `samePath` semantics are the filesystem's, not the string's

Equality rules:

| Platform | Case | Separator | Trailing sep | UNC / drive |
|---|---|---|---|---|
| `win32` | case-insensitive | `\` and `/` interchangeable | ignored | `C:\foo` == `c:\foo`; `\\srv\share` preserved |
| `darwin` | case-insensitive (HFS+ default) | `/` only | ignored | n/a |
| `linux` | case-sensitive | `/` only | ignored | n/a |

Implementation: run both inputs through `normalizePath` with the same platform, then string-compare (case-folded for Windows/macOS).

**macOS caveat:** APFS in case-sensitive mode does exist but is rare and opt-in. Matching HFS+ default behavior (case-insensitive) is the right default for 99% of macOS users. Documented as a known limitation.

**Alternative considered:** normalize-and-compare only on stored paths (not on session cwds). Rejected — the whole point is that drift between session `cwd` (reported by pi) and pinned storage (written by dashboard) is what breaks grouping today. Both sides must use `samePath`.

### 4. `normalizePath` uses `node:path.normalize` + `.resolve` but preserves case as reported

```
normalizePath("C:\\Dev\\BB\\pi-agent-dashboard\\", "win32")
  → path.win32.resolve(input)     // "C:\\Dev\\BB\\pi-agent-dashboard"
  → separator collapse (\\+ → \)  // already handled by resolve
  → drop trailing sep              // resolve already does this
  → return as-is (preserve case)   // Windows FS preserves case
```

We do NOT lowercase. `samePath` folds at compare time, not at storage time. This keeps the stored path human-readable (`Dev\BB` not `dev\bb`).

**Alternative considered:** always store lowercase on Windows for consistency. Rejected — UI would show ugly lowercase paths on Windows where the user expects title-case, and the original case *is* correct per the filesystem.

### 5. `parsePathInput` is the client's ONLY path-parsing entry point

Replaces `PathPicker.tsx`'s inline `parseInput`. Same signature (`{ parent, partial }`), but handles:

- Windows drive letters: `"C:\\Users\\m"` → `{ parent: "C:\\Users", partial: "m" }`; `"C:\\"` → `{ parent: "C:\\", partial: "" }`.
- UNC paths: `"\\\\server\\share\\path"` — parent splits on path segments, not on the `\\server\share` root.
- Unix absolute: `"/Users/me/Dev"` → `{ parent: "/Users/me", partial: "Dev" }`.
- Unix root: `"/"` → `{ parent: "/", partial: "" }`.
- Mixed-separator Windows input from previous picker state: `"C:\\Users\\m/Dev"` treated as if all `\` — `parent: "C:\\Users\\m"`, `partial: "Dev"`.

### 6. Client needs to know the OS to parse correctly

The client runs in the browser; it doesn't have `process.platform`. Two options:

a) **Server ships platform in the browse response.** `BrowseResult` already returns `{ entries, parent, current }`. Add `platform: "win32" | "darwin" | "linux"` — one field. Client caches the last-seen value.

b) **Client sniffs the path.** If the input contains `\` or matches `/^[A-Za-z]:/`, treat as Windows. Heuristic.

**Decision: (a).** Deterministic, matches the server's truth. Small protocol change in `BrowseResult`. Backward-compatible: old clients ignore the field.

### 7. Windows multi-drive invariants (A:, B:, C:, …) and UNC paths

Windows has a separate filesystem root per drive letter, plus UNC (`\\server\share`) roots. The primitive must treat these as completely independent namespaces — `A:\Foo` and `B:\Foo` have nothing to do with each other even when their path tails are identical.

Node's `path.win32.resolve` handles multi-drive correctly out of the box:

| Input | `path.win32.resolve` | Notes |
|---|---|---|
| `B:\Dev\BB` | `B:\Dev\BB` | each drive is its own root |
| `A:\Foo\Bar` | `A:\Foo\Bar` | different drive, independent |
| `D:\\` | `D:\` | trailing slash collapsed |
| `B:/Dev/BB` | `B:\Dev\BB` | separator conversion |
| `B:\Dev\..\BB` | `B:\BB` | `..` resolved within drive |
| `\\server\share\dir` | `\\server\share\dir` | UNC root preserved |

So `normalizePath` gets multi-drive right by delegation. The spec-level invariants this change codifies on top:

- **`samePath` never merges different drives.** `A:\x` and `B:\x` return `false`. Same for any UNC vs drive-letter cross-comparison. Case-folding only applies *within* a drive.
- **Drive-letter case IS case-insensitive.** `B:\Dev` and `b:\Dev` are the same path. Windows filesystem treats drive letters as case-insensitive, and so does `samePath`.
- **Bare drive letter `B:` (without backslash) is treated as drive root.** The Windows semantic for `B:` alone is "current directory on the B drive", which Node's `path.win32.resolve` implements by falling back to `process.cwd()`. That's cwd-dependent and useless for a pin dialog where the user clearly means "go to the root of B drive." `parsePathInput` shortcuts this: `B:` → `{ parent: "B:\\", partial: "" }` without touching `path.win32.resolve`.
- **Drive-relative typed form `B:Dev` is also treated as drive-root-plus-partial.** Windows would interpret this as `<B-drive-cwd>\Dev`, which is not what a user typing in a picker means. We interpret it defensively: `{ parent: "B:\\", partial: "Dev" }`.

**One existing bug this work surfaces (outside the primitive, in `server/src/browse.ts`):**

```ts
// current:
const parent = resolved === "/" ? null : path.dirname(resolved);
```

This only recognizes the Unix root. On Windows, `path.dirname("B:\\")` returns `"B:\\"` (a root is its own parent), so `parent` is never `null` for `B:\`, `C:\`, or `\\server\share\`. The picker then shows a `..` entry at the drive root that does nothing. Fix: detect "is this a filesystem root" via `path.parse(resolved).root === resolved`. This is a small follow-up in the same migration (see tasks.md §4).

### 8. Preferences store migrates on load

In `createPreferencesStore`:

```ts
const rawPinned = data.pinnedDirectories ?? [];
let pinnedDirectories = rawPinned
  .map(normalizePath)            // NEW: normalize first
  .map(safeRealpathSync);         // then resolve symlinks (existing)
pinnedDirectories = [...new Set(pinnedDirectories)];
```

If the normalized/realpathed result differs from the on-disk form, the store marks itself dirty and writes on the next debounce tick. Users on stable paths see nothing; users with drifty entries see one silent rewrite.

## Risks / Trade-offs

- **Risk:** Client's `parsePathInput` needs the server's platform, but the server's platform is only known after the first `browseDirectory` response. First render might use a wrong default.
  **Mitigation:** The very first `useEffect` in `PathPicker` already fetches from the server before the user can type anything meaningful (there's a loading state). Cache the platform in a React context seeded from the first `/api/health` response (which already runs at app load and can include `platform` trivially). Fallback default: `process.platform` equivalent derived from `navigator.userAgent` — crude but acceptable for the 100ms before the real answer arrives.

- **Risk:** `samePath`-keyed `Map` requires a custom key derivation because plain `Map<string>` is string-keyed. Naive fix is to use the normalized string as the key — cheap, but loses the original case.
  **Mitigation:** Key by the *normalized* string (used only for grouping), store the *original* on the value (used for display). `DirectoryGroup.cwd` already exists as a separate field, so display keeps the original.

- **Risk:** macOS APFS case-sensitive mode users get unexpected merging (e.g., `Projects` and `projects` collapse into one group).
  **Mitigation:** Matches macOS Finder behavior — this is what users expect. Document in the module JSDoc.

- **Risk:** Stored preferences.json from before this change might have paths like `B:\Dev\BB\pi-agent-dashboard\` (trailing sep). After migration, entries collapse — if the same path appears twice (once with slash, once without), the dedup `Set` silently loses one.
  **Mitigation:** That's the desired behavior — they were duplicates anyway.

- **Trade-off:** Adding a module + migrating three call sites is more work than a one-line `path.resolve` in the server handler. Accepted because the bug class recurs (we'll see the same issue when someone adds a different path-taking REST endpoint or UI control), and a shared primitive is the definition of "don't solve this problem again."

## Migration Plan

1. **Phase 1 — Additive:** Ship `platform/paths.ts` + tests. Nothing uses it yet. Risk-free.
2. **Phase 2 — Server:** Migrate `directory-handler.ts` + `preferences-store.ts`. Existing stored paths get normalized on next server boot. Users see nothing unless they had drifty entries (in which case the drift heals).
3. **Phase 3 — Client:** Migrate `session-grouping.ts` (uses `samePath` via normalized key). Migrate `PinDirectoryDialog` trailing-slash strip. Migrate `PathPicker.parseInput` — this is the biggest client change; run it last so the server side is already correct when the UI ships.
4. **Phase 4 — Docs:** `docs/architecture.md` gets a "Path handling" subsection under "Platform primitives". `AGENTS.md` gets the `platform/paths.ts` entry. README Troubleshooting gets a "pinned folder doesn't group my sessions" entry.
5. **Rollback:** Each phase revertable independently. Phase 1 is pure addition. Phase 2 revert just removes the normalize calls. Phase 3 revert restores the Unix-only `parseInput`.

## Open Questions

- **Q1:** Should `BrowseResult.platform` land as part of this change, or is it worth its own tiny protocol change? *(Leaning: include it here — it's a one-line protocol extension and the reason is pure consequence of this work.)*
- **Q2:** Do we want `paths.pathsForSync(p)` (flag machine-local paths) in v1, or defer? It's a diagnostic helper for a future "your preferences.json has Windows paths, you probably shouldn't sync it" warning. *(Leaning: defer. Named as non-goal for now; trivial to add later.)*
- **Q3:** Should session grouping ALSO normalize the *display* path (currently the raw `cwd`)? *(Leaning: no — display the original case and separator as pi reports it; only normalize for comparison. UI expectation is that the path "looks right".)*
- **Q4:** Is there any existing test infrastructure for client-side React components that tests `PathPicker` behaviour? If not, do we need to add one now? *(Check during implementation — existing `known-servers-sections.test.ts` is logic-only, so we'd test `parsePathInput` as a pure function and skip DOM assertions.)*
- **Q5:** Should the primitive also handle Windows extended-length paths (`\\?\C:\very\long\...`, `\\?\UNC\server\share\...`)? *(Out of scope for v1 — dashboard paths don't hit the 260-char MAX_PATH limit in practice. Easy follow-up later if needed.)*
- **Q6:** NTFS alternate data stream suffixes (`file.txt:stream-name`) — does the primitive strip them? *(No, treat them as part of the path. The filesystem does. No dashboard feature manipulates them today.)*
