## Why

The dashboard relies on a small set of external CLIs — `jj`, `openspec`, `git`, `bash`, `gh`, `zrok`, `npx` — across the bridge extension, server, build scripts, and assistant chat. Six of the seven are already registered in `ToolRegistry` and surface in Settings → Tools with override + source-badge UX (`npx` was registered with a bundled-Node-aware chain by the archived `fix-node-resolution-under-electron` change). One is not:

- **`bash`** is hardcoded as the string `"sh"` in `packages/extension/src/command-handler.ts:728`, where `!`/`!!` chat-escapes run user shell commands. On Windows hosts without Git-for-Windows or WSL on PATH, that spawn fails with a bare `ENOENT` that the user cannot map to "install Git for Windows" without reading the server log.

Two distinct problems compound the silent-failure:

1. **`bash` is not in the registry**, so it neither appears in Settings → Tools nor benefits from the override / managed / where strategy chain that every other binary tool uses.
2. **Missing-tool errors carry no install guidance.** When any registered binary tool is missing (`bash`, `jj`, `gh`, `zrok`, `npx`, …) the Settings → Tools row renders `"not found"` with no path forward. Every OS has a canonical install command (`winget install …`, `brew install …`, `apt install …`) but the dashboard knows none of them. Users must leave the app, search the web, and guess.

These are coupled: registering `bash` without install help just adds another `"not found"` row on a clean Windows install. Shipping install hints without `bash` registered leaves the original silent-spawn-failure intact.

## What Changes

### Part 1 — Register `bash` in `ToolRegistry`

- Add `binaryDef("bash")` to `registerDefaultTools` in `packages/shared/src/tool-registry/definitions.ts`. Uses the stock chain (`override → managed → where`).
- `bash`: the `managed` slot is structurally vestigial (bash is never on npm); kept for chain uniformity.
- No platform gate. `bash` is meaningful on every OS (macOS / Linux: `/bin/bash`, `/opt/homebrew/bin/bash`; Windows: Git-for-Windows, WSL, MSYS2). The chain naturally falls through to "not found" when none are present.

**Already done — not in scope.** `npx` is already registered in `definitions.ts` (`npxBinaryDef`) with a bundled-Node-aware strategy chain (`override → bundledNode → managedBin → where`), landed by the archived `fix-node-resolution-under-electron` change. This proposal neither re-registers `npx` nor adds `installHints` to it; a user who needs `npx` installs Node (see the `node` install hints).

### Part 2 — Migrate the `!`/`!!` escape callsite

- `packages/extension/src/command-handler.ts:728` replaces `pi.exec("sh", ["-c", cmd], …)` with `registry.resolve("bash")` and spawns the resolved absolute path. When `Resolution.ok === false`, the handler emits a structured `MissingToolError` payload (`{ toolName: "bash" }`) instead of attempting the spawn. The chat renderer turns that payload into an inline error component with a deep-link to Settings → Tools.
- **Explicit non-target**: the Unix-headless `sh -c "tail -f /dev/null | pi"` wrapper (now built in the platform spawn machinery under `packages/shared/src/platform/`, formerly at `process-manager.ts:475`) stays as `"sh"`. That wrapper uses only POSIX features and runs in a Unix-only code path; `/bin/sh` is the correct contract there, not `bash`. Routing through the bash registration would be a semantic regression.
- **Explicit non-target**: `packages/shared/src/platform/shell.ts` interactive-PTY shell selection. That picks the user's `$SHELL` preference for terminal sessions; it is not a script-exec callsite. Separate proposal if it ever needs registry routing.

### Part 3 — `installHints` metadata on `ToolDefinition`

- Extend `ToolDefinition` (in `packages/shared/src/tool-registry/types.ts`) with an optional `installHints?: InstallHints` field. The data model:

  ```ts
  interface InstallHints {
    darwin?: PlatformInstallHint;
    win32?:  PlatformInstallHint;
    linux?:  PlatformInstallHint;
    /** Anchor under docs/faq.md for human-written install guidance. */
    docsAnchor?: string;
  }
  interface PlatformInstallHint {
    /** Package-manager → install command (e.g. "brew install jj"). */
    commands?: Record<string, string>;
    /** Free-form fallback text when no PM applies (e.g. "Pre-installed on macOS"). */
    manual?: string;
    /** Canonical download URL (vendor site). */
    url?: string;
  }
  ```

- Populate hints for every existing binary tool that is genuinely user-installable: `bash`, `jj`, `gh`, `zrok`, `git`, `node`. Skip platform-utility binaries (`wmic`, `powershell`, `tasklist`, `taskkill`, `ps`, `pgrep`, `wt`) — they ship with the OS and have no install story.
- The registry treats `installHints` as opaque metadata. `resolve()` ignores it; only `list()` surfaces it through the existing `Resolution` snapshot.

### Part 4 — REST `/api/tools` carries `installHints` through to the client

- `packages/server/src/routes/tool-routes.ts` already returns the per-tool `Resolution` list; extend the response shape to include the tool's `installHints` (a static lookup from the definition, not part of `Resolution` itself). The Diagnostics test fixture (`packages/client/src/lib/tools-api.ts`) gains the new field as optional.

### Part 5 — Settings → Tools UI: `[Install ▾]` action on missing rows

- `packages/client/src/components/ToolsSection.tsx` renders a per-row `[Install ▾]` dropdown when `tool.ok === false` AND `tool.installHints?.[currentOs]` exists. Dropdown items:
  - One row per package-manager command, with a copy-to-clipboard button.
  - One row per "manual" fallback text (display-only, no copy button).
  - One row "Read more in docs ↗" linking to `docs/faq.md#<docsAnchor>` when present.
- The dropdown filters by current OS (`navigator.userAgentData.platform` with a Node `os.platform()` server-side hint as fallback) so Windows users do not see `brew` commands. Rows whose `tool.ok === true` are unchanged.

### Part 6 — Inline chat error component for missing-tool spawns

- New component `packages/client/src/components/chat/MissingToolInlineError.tsx`. Renders a structured `MissingToolError` payload as a one-line in-chat error with `[Install <tool> →]` deep-linking into `Settings → Tools` and scrolling the matching row into view.
- The bridge-extension emits the payload as a chat error event; the client maps the payload to the component via the existing chat-renderer dispatch.

### Part 7 — Docs

- Add anchored sections to `docs/faq.md`: `#install-bash`, `#install-jj`, `#install-gh`, `#install-zrok`, `#install-git`, `#install-node`. Each section repeats the per-OS commands the UI already shows AND adds a short "why does the dashboard need this" paragraph plus a link to the vendor's docs. Acts as the single source of human-written install guidance — the UI hints are derived data, the FAQ is the narrative.

### Part 8 — Doctor cross-reference (forward note only)

- Post `fix-doctor-stale-managed-install-check` landing, Doctor's missing-tool advisories (in `packages/shared/src/doctor-core.ts`) SHOULD consume the same `installHints` metadata for consistency. Not implemented in this proposal — recorded as a follow-on in `design.md` and called out explicitly in the spec delta.

## Capabilities

### New Capabilities

(none — this change extends an existing capability)

### Modified Capabilities

- `tool-registry`: Registers `bash` as a new binary tool. Adds an `installHints` field to the `ToolDefinition` contract and to the REST `/api/tools` response. Specifies that the bridge's `!`/`!!` chat-escape MUST resolve `bash` through the registry (never spawn `"sh"` directly). Specifies the UI contract for `[Install ▾]` actions on missing-tool rows.

## Impact

- **Code (new files)**:
  - `packages/client/src/components/chat/MissingToolInlineError.tsx` (~60 lines) — inline chat error renderer with `[Install <tool> →]` deep-link.
  - `packages/shared/src/tool-registry/__tests__/install-hints.test.ts` (~70 lines) — asserts every user-installable binary tool ships hints for every supported OS; lints the FAQ anchor set.
  - `packages/client/src/components/__tests__/ToolsSection.install-dropdown.test.tsx` (~80 lines) — renders missing row, asserts per-OS filtering, asserts copy-to-clipboard wiring.

- **Code (modified files)**:
  - `packages/shared/src/tool-registry/types.ts` — add `InstallHints`, `PlatformInstallHint`; extend `ToolDefinition` with optional `installHints`.
  - `packages/shared/src/tool-registry/definitions.ts` — register `bash`; attach `installHints` to `bash`, `jj`, `gh`, `zrok`, `git`, `node`.
  - `packages/shared/src/tool-registry/registry.ts` — `list()` includes per-tool `installHints` in its result shape (carried through, not transformed).
  - `packages/extension/src/command-handler.ts` — replace `"sh"` literal at the `!`-escape branch with `registry.resolve("bash")` + missing-tool structured-error emission.
  - `packages/extension/src/__tests__/command-handler.test.ts` — new case: missing bash → emits `MissingToolError`, does not spawn.
  - `packages/server/src/routes/tool-routes.ts` — REST response carries `installHints`.
  - `packages/client/src/lib/tools-api.ts` — type for the new field.
  - `packages/client/src/components/ToolsSection.tsx` — `[Install ▾]` dropdown UI on rows where `ok === false`.
  - `docs/faq.md` — six new anchored install-guidance sections.
  - `openspec/specs/tool-registry/spec.md` — delta in `specs/tool-registry/spec.md` (this change directory).

- **Migration**: none. `installHints` is additive optional metadata; existing code that does not consume it is unaffected.
- **Compatibility**: REST `/api/tools` response gains an optional field; existing clients ignore it. The `command-handler.ts` change is a behavior fix (structured error vs. silent ENOENT) — no public-API break.
- **Rollback**: revert the change directory. The `bash` registration and `installHints` field are additive; reverting restores the prior `"sh"` literal at the `!`-escape callsite.
- **Cross-reference**: orthogonal to the archived `fix-doctor-stale-managed-install-check`. That change deprecated the false "managed install incomplete" Doctor row; this proposal keeps the `managed` strategy slot in `bash` for chain uniformity. A future proposal may unify the two threads.
- **Cross-reference**: the archived `fix-node-resolution-under-electron` already registered `npx` with a `bundledNodeStrategy` (`override → bundledNode → managedBin → where`) so `node` / `npm` / `npx` resolve correctly under Electron. `npx` registration is therefore already complete; this proposal does not touch it.
