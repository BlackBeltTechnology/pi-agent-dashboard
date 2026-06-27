# serve-agent-artifact-previews

## Why

Tool output linkifies absolute paths and the dashboard previews them. Agent
tools write artifacts to a **per-user, cross-repo temp dir**, not into any
session repo. The `browser` skill saves screenshots to
`~/.agent-browser/tmp/screenshots/…png` and emits that absolute path in its
output. Clicking it opens `FilePreviewOverlay`, which loads the image via:

```
<img src="/api/file/raw?cwd=<session>&path=/Users/robson/.agent-browser/tmp/screenshots/…png">
```

`/api/file/raw` contains paths to the session `cwd`. The artifact lives outside
every session cwd **and** outside every git repo:

```
~/.agent-browser/tmp  →  git rev-parse  →  "fatal: not a git repository"
```

So the raw route returns 403 `path outside working directory`, the `<img>`
`onError` fires, and the overlay shows *"Failed to load image"*
(`FilePreviewOverlay.tsx:169`). The companion change
`git-root-file-containment` does NOT fix this: its trust boundary is the git
common root, and this artifact has no git root at all.

This is a distinct containment class: **tool-managed artifacts in a global
temp root**, not repo files. They will never be inside a repo, so previewing
them requires a dedicated artifact-root anchor.

## What Changes

- Define a server-side **artifact-root allowlist**, real-path resolved:
  default `realpath(~/.agent-browser/tmp)`, plus `AGENT_BROWSER_SCREENSHOT_DIR`
  when set (the same env var the `agent-browser` CLI honors). The list is the
  extension point for future tool artifact dirs.
- `GET /api/file/raw` gains the artifact roots as an **additional containment
  anchor**, layered after the session `cwd` (and the git-root layer from
  `git-root-file-containment`). A path is served if it resolves inside a
  session cwd, that cwd's git root, OR an artifact root.
- Artifact-root serving is **image-only**: a path anchored on an artifact root
  is served only when its extension is a recognized image type (`IMAGE_EXTS`).
  This keeps the new global root scoped to the actual use case (screenshots)
  and blocks artifact-root reads of arbitrary files.
- Containment for artifact roots resolves the **real path**
  (`fs.realpath`) before the compare, so a `..` segment or symlink cannot
  escape the root.
- The existing session-cwd gate is unchanged — the request still carries a
  valid session cwd; the artifact root is an extra anchor, not a bypass.

Scope: **only `/api/file/raw`.** `/api/file/render` is `.adoc`-only and
`/api/file` is text — neither serves the screenshot bytes.

## Impact

- Affected specs: `agent-artifact-serving` (new capability).
- Affected code:
  - `packages/server/src/lib/artifact-roots.ts` (new — allowlist + realpath
    resolve + cache).
  - `packages/server/src/routes/file-routes.ts` (`/api/file/raw` anchor +
    image-only artifact gate).
- Composes with `git-root-file-containment`: reuses that change's parameterized
  `isAllowed(resolved, { anchors })` helper, adding artifact roots to the raw
  route's anchor set. If that change has not landed, this one introduces the
  same helper signature.

## Best-effort scope (A1, resolved)

The `agent-browser` screenshot output dir is **producer-configurable**:
`--screenshot-dir <path>` (CLI flag) or `AGENT_BROWSER_SCREENSHOT_DIR` (env). A
static server-side allowlist therefore cannot cover every case:

- **Env-configured** (`AGENT_BROWSER_SCREENSHOT_DIR`) — covered: the server reads
  the same env var into the allowlist.
- **Default dir** (`~/.agent-browser/tmp`) — covered.
- **CLI-flag** (`--screenshot-dir /elsewhere`) — **NOT covered**: the flag is
  invisible to the server, so a screenshot written there still 403s.

This change is thus a **best-effort fix for the common (default + env) case**,
not a complete one. The robust fix is transport-level: deliver agent screenshots
inline so no containment-guarded path-link exists (Fix B; see Out of Scope).
Fix A and Fix B are complementary — A makes default-dir previews work today; B
removes the failure mode entirely. Track B as the follow-up.

## Security note

An artifact root is a **per-user global directory that crosses the repo trust
boundary** established by `git-root-file-containment`. This is accepted on
narrow grounds: it is the same OS user, the dir is tool-managed and ephemeral,
serving is image-only, and real-path containment prevents traversal out of the
root. No artifact root grants read of repo files, dotfiles, or non-image
content.

## Out of Scope

Fix B (deliver agent screenshots inline so no path-link exists) is a separate
transport concern. `2026-04-04-inline-image-tool-results` already inlines some
tool images; aligning the `browser` skill's screenshot output onto that path is
tracked separately and is complementary, not a replacement, for this change.
