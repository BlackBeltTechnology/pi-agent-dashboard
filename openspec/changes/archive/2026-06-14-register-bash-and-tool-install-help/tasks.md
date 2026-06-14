# Tasks

## 1. Tool registry — `bash` + `npx` registration and `installHints` data model

- [x] 1.1 Extend `ToolDefinition` in `packages/shared/src/tool-registry/types.ts` with optional `installHints?: InstallHints`; declare `InstallHints` and `PlatformInstallHint` interfaces per the proposal.
- [x] 1.2 Add `registry.register(binaryDef("bash", deps))` to `registerDefaultTools` in `packages/shared/src/tool-registry/definitions.ts`. No platform gate. Stock strategy chain.
- [x] 1.3 (removed — `npx` is already registered via `npxBinaryDef` with a bundled-Node-aware chain; landed by archived `fix-node-resolution-under-electron`. No work here.)
- [x] 1.4 Attach `installHints` payloads to `bash`, `jj`, `gh`, `zrok`, `git`, `node` registrations in `definitions.ts`. Source per-OS commands from vendor docs; record canonical URLs.
- [x] 1.5 Update `registry.list()` so the snapshot it returns carries per-tool `installHints` opaquely (no transformation, no validation at resolve-time).

## 2. Tests — registry + install hints

- [x] 2.1 Add `packages/shared/src/tool-registry/__tests__/install-hints.test.ts`:
  - Every binary tool in `{bash, jj, gh, zrok, git, node}` MUST ship `installHints` for `darwin`, `win32`, and `linux`.
  - Every populated platform hint MUST have at least one of `commands`, `manual`, or `url`.
  - Every `docsAnchor` MUST correspond to an `<h2>`/`<h3>` anchor present in `docs/faq.md`.
- [x] 2.2 Extend `packages/shared/src/tool-registry/__tests__/definitions.test.ts` (or equivalent) to assert `bash` is registered, resolves via the override → managed → where chain, and is platform-agnostic.
- [x] 2.3 Add a test that resolution semantics are unchanged for the other binary tools after the `installHints` field is added (regression guard).

## 3. Bridge extension — `!`/`!!` escape migration

- [x] 3.1 Replace `pi.exec("sh", ["-c", command], …)` at `packages/extension/src/command-handler.ts:728` with a `registry.resolve("bash")` call.
- [x] 3.2 On `Resolution.ok === false`, emit a structured `MissingToolError` chat payload (`{ kind: "missing-tool", toolName: "bash" }`) instead of attempting the spawn. Define the payload type in `packages/shared/src/` if a suitable type does not already exist.
- [x] 3.3 On `Resolution.ok === true`, spawn `r.path` directly (no shell, no PATH dependency).
- [x] 3.4 Add a `command-handler.test.ts` case: when `registry.resolve("bash")` returns `{ ok: false }`, the handler emits exactly one `MissingToolError` event and never invokes `pi.exec`.
- [x] 3.5 Add a `command-handler.test.ts` case: on the happy path the handler invokes `pi.exec(r.path, ["-c", cmd], …)` with the resolved absolute path.
- [x] 3.6 Confirm the Unix-headless `sh -c "tail -f /dev/null | pi"` wrapper (now built in the platform spawn machinery under `packages/shared/src/platform/`, no longer at `process-manager.ts:475`) is NOT modified (`/bin/sh` is the correct POSIX contract there; documented in the test as an explicit non-target).

## 4. Server — REST surface

- [x] 4.1 Extend the `/api/tools` response in `packages/server/src/routes/tool-routes.ts` to include each tool's `installHints` from its `ToolDefinition`.
- [x] 4.2 Update or add a route test asserting the response shape includes `installHints` for tools that declare it and omits the field for tools that do not.

## 5. Client — Settings → Tools UI

- [x] 5.1 Update `packages/client/src/lib/tools-api.ts` types to include the optional `installHints` field.
- [x] 5.2 Implement the `[Install ▾]` dropdown in `packages/client/src/components/ToolsSection.tsx`. Render only when `tool.ok === false` AND `tool.installHints?.[currentOs]` exists.
- [x] 5.3 Filter dropdown items by the current OS (server-provided hint via `/api/health` or client-side `navigator.userAgentData.platform`). Document the source in code comments.
- [x] 5.4 Each command row has a copy-to-clipboard button (use the existing clipboard helper if one exists; otherwise inline `navigator.clipboard.writeText`).
- [x] 5.5 Add `packages/client/src/components/__tests__/ToolsSection.install-dropdown.test.tsx` covering: dropdown visibility (missing vs found), per-OS filtering, copy-to-clipboard call, docs link rendering.

## 6. Client — inline chat error component

- [x] 6.1 Create `packages/client/src/components/chat/MissingToolInlineError.tsx`. Props: `{ toolName: string }`. Renders a one-line error with `[Install <toolName> →]` action.
- [x] 6.2 The action navigates to Settings → Tools and scrolls the matching row into view (use existing routing helpers + `document.getElementById(`tool-row-${toolName}`)?.scrollIntoView({ block: "center" })`).
- [x] 6.3 Wire the chat-renderer dispatch (existing chat event → component mapping) to route `MissingToolError` payloads to the new component.
- [x] 6.4 Add a render test for `MissingToolInlineError` covering link click + scroll-into-view trigger.

## 7. Docs

- [x] 7.1 Add anchored install-guidance sections to `docs/faq.md`: `## Install bash`, `## Install jj`, `## Install gh`, `## Install zrok`, `## Install git`, `## Install node`. Each section: per-OS commands (matching the registry hints), vendor docs link, "why the dashboard needs it" paragraph.
- [x] 7.2 Confirm anchors match the `docsAnchor` values in `definitions.ts` (lint test 2.1 enforces this).
- [x] 7.3 Update `AGENTS.md` "Key Files" section ONLY if any new file exceeds 200-char architectural-backbone status. Per-file detail goes in `docs/file-index-shared.md` / `file-index-client.md` per the Documentation Update Protocol; delegate the file-index edits to a subagent in caveman style.

## 8. Spec delta + final verification

- [x] 8.1 Author `openspec/changes/register-bash-and-tool-install-help/specs/tool-registry/spec.md` with ADDED + MODIFIED requirements per the proposal.
- [x] 8.2 Run `openspec validate register-bash-and-tool-install-help --strict` (or equivalent) and resolve any schema errors.
- [x] 8.3 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no regressions; grep `FAIL` per the project's testing protocol. (Changed packages pass fully in isolation: shared 1177, extension 971, client 2446. Full-suite failures are pre-existing load/timeout flakes in server-spawning tests — pass alone, none touch this change.)
- [x] 8.4 Run `npm run build` to confirm client compilation succeeds with the new component + types. (Also `npm run lint` / tsc --noEmit: 0 errors.)
- [x] 8.5 Manual smoke test (REQUIRES real macOS/Windows/Linux hosts — to be performed by maintainer post-merge):
  - macOS / Linux: `!ls` in dashboard chat resolves bash via `where`, runs cleanly.
  - Windows (clean, no Git-for-Windows): `!ls` shows `MissingToolInlineError` with deep-link; Settings → Tools shows `bash` row with `[Install ▾]` populated.
  - Windows (with Git-for-Windows): `!ls` resolves bash via `where` to `C:\Program Files\Git\bin\bash.exe`.
