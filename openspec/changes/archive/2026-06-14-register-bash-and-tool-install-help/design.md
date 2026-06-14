## Context

`ToolRegistry` (introduced by `2026-04-19-consolidate-tool-resolution` and extended by `2026-05-09-register-build-time-tools`) is the dashboard's single source of truth for resolving every external binary, module, and directory it spawns or imports. Five of the six CLIs the dashboard actually uses are registered: `jj`, `openspec` (executor), `git`, `gh`, `zrok`. The sixth — `bash` — was missed because the `!`/`!!` chat-escape was implemented before the registry existed and the literal string `"sh"` never came up for revisit.

Separately, the Settings → Tools UI surfaces missing-tool rows as bare `"not found"` text. Every supported OS has a canonical install command per tool, but the dashboard does not record them anywhere — the knowledge is scattered across the team's tribal memory and the FAQ has no install section. The downstream effect is that every new contributor who hits a missing `bash` / `jj` / `gh` on a clean Windows VM ends up Google-searching, often landing on the wrong installer.

This proposal closes both gaps in a single change because they are coupled at the user-experience layer:

- Registering `bash` without install help just adds another silent `"not found"` row.
- Shipping install help without registering `bash` leaves the original ENOENT failure mode in place.

## Goals

- Resolve `bash` through `ToolRegistry` everywhere a script-exec callsite needs it (today: one callsite — `!`/`!!` chat-escape).
- Provide structured, OS-aware install guidance in Settings → Tools for every user-installable binary tool the dashboard depends on.
- Surface missing-tool spawn failures as actionable inline chat errors that deep-link into the install UI.

## Non-Goals

- Bundling binaries into Electron resources. Out of scope; user accepted "registration only" framing.
- Touching the Unix-headless `sh -c "tail -f /dev/null | pi"` wrapper (now built in the platform spawn machinery under `packages/shared/src/platform/`, formerly at `process-manager.ts:475`). That wrapper is POSIX `/bin/sh`, not bash; routing it through the bash registration would be a semantic regression.
- Touching `packages/shared/src/platform/shell.ts` interactive-PTY shell selection. That picks the user's `$SHELL` for terminal sessions — a separate concern.
- Adding `cmd.exe`, `powershell`, or `pwsh` to the registry. They are always present on Windows (user-confirmed) and have no install story.
- Removing the `managed` strategy slot from binary tools. Cross-cutting concern; see follow-on note below.

## Decision: register `bash` with the stock `binaryDef()` chain

Use `binaryDef("bash", deps)`, which yields `[override, managed, where]`. The `managed` slot is structurally vestigial for `bash` (it is never on npm and `~/.pi-dashboard/node_modules/.bin/` will never hold it), but keeping it preserves chain uniformity with every other binary tool. The cost is one extra `fs.statSync` per cold resolution, which is negligible.

Alternatives considered and rejected:

- **Custom chain `[override, where]` for bash only.** Cleaner in isolation, but introduces a per-tool exception in `definitions.ts`. The reviewer cost of "why does bash deviate?" exceeds the runtime cost of one extra stat.
- **Custom chain conditional on `fix-doctor-stale-managed-install-check` landing.** Couples this proposal to a different proposal's timeline. Avoid.

A follow-on proposal — provisionally `deprecate-managed-bin-strategy` — can revisit the managed slot across all binary tools once the doctor-stale change has landed and the managed-install deprecation is a closed question.

## Decision: `InstallHints` lives on `ToolDefinition`

Rejected: putting install hints in a separate `INSTALL_HINTS` lookup table or in `docs/faq.md` only.

Reasons for co-locating with `ToolDefinition`:

1. **Single source of truth.** The definition already names the tool, its strategy chain, its classifier, and its kind. Install guidance is part of "what is this tool"; splitting it across files invites drift.
2. **Type-safe per-tool data.** A separate `Record<ToolName, InstallHints>` requires manual synchronization with the registration list. TypeScript catches mismatches when the data is attached to the definition.
3. **The registry stays opaque to the hints.** `resolve()` ignores them. Only `list()` carries them through to the UI. The hints do not affect resolution semantics — they are pure UX metadata.

## Decision: `installHints` shape

```ts
interface InstallHints {
  darwin?: PlatformInstallHint;
  win32?:  PlatformInstallHint;
  linux?:  PlatformInstallHint;
  docsAnchor?: string;
}
interface PlatformInstallHint {
  commands?: Record<string, string>;  // pkg-manager → command
  manual?: string;                     // free-form text
  url?: string;                        // vendor download URL
}
```

Rejected alternatives:

- **Flat `Record<string, string>` per platform.** No room for free-form fallback ("pre-installed on macOS") or a vendor URL. Forces the UI to special-case those.
- **One commands list per OS, no nesting.** Loses the package-manager label, so the UI cannot show "winget" vs. "choco" as separate dropdown items.
- **String unions for known package managers.** Premature; the registry should not pin the set of supported PMs. A `Record<string, string>` lets vendors add `nix`, `flatpak`, `pkgx`, etc. without a registry change.

## Decision: `MissingToolError` payload structure

The bridge extension emits a structured chat event when a registry-resolved tool is missing at spawn time:

```ts
interface MissingToolError {
  kind: "missing-tool";
  toolName: string;
  // No installation hints embedded — the client fetches them via /api/tools.
  // Keeps the payload small and avoids cache-staleness between bridge + server.
}
```

The payload is intentionally minimal: just the tool name. The client renders `MissingToolInlineError` which deep-links into Settings → Tools, where the live registry hints are already cached. This avoids embedding install hints in the chat event and keeps the bridge unaware of the UI's dropdown contract.

## Decision: deep-link semantics

Clicking `[Install bash →]` in an inline chat error MUST:

1. Navigate to the Settings → Tools route.
2. Scroll the matching row into view (via DOM id `tool-row-${toolName}`).
3. Open the `[Install ▾]` dropdown automatically.

Step 3 is the affordance that turns the inline error into a single-click resolution path. Without it, the user lands on Settings → Tools and still has to find and click the dropdown manually.

## Decision: OS detection for dropdown filtering

Two sources, in order of preference:

1. **Server-provided** via `/api/health` → `os.platform()`. Authoritative for the host the dashboard runs on.
2. **Client `navigator.userAgentData.platform`** as fallback when health response is stale.

The server source is preferred because the user may be accessing the dashboard from a different OS than the host (e.g. mobile browser hitting a Linux dashboard). Install commands MUST target the **host** OS, not the browser OS — otherwise a user on an iPhone sees `brew install jj` for a Linux host.

## Doctor cross-reference (forward note)

`fix-doctor-stale-managed-install-check` (now archived/landed) deprecated the false "managed install incomplete" Doctor row. Post-landing, Doctor still emits missing-binary advisories for tools the registry reports as `ok: false`. A follow-on change SHOULD consume `installHints` in those Doctor rows for consistency, so the same install guidance appears in Doctor (Electron native menu) and Settings → Tools (web UI).

Not implemented here because:

- `fix-doctor-stale-managed-install-check` may land first or second — making this proposal depend on it creates a merge-order constraint.
- The two surfaces have different rendering primitives (Electron native menu vs. React); the UI work is non-trivial and deserves its own proposal.

## Risks / open questions

1. **OS detection edge cases.** A dashboard running headless on a Linux VM accessed via Windows browser will show Linux commands. Correct, but might surprise a user expecting "their OS". Mitigation: the FAQ section labels each command block with its target OS, so a Windows user reading Linux commands sees the heading "Linux" and is not misled.

2. **`installHints` data freshness.** Vendor install commands change occasionally (`winget` package IDs rename, `brew` formula moves). The hints are static data in `definitions.ts`; updates ride with dashboard releases. Acceptable — this is install guidance, not a critical path, and `[Read more in docs ↗]` covers the case where the canned command goes stale.

3. **Copy-to-clipboard on non-secure contexts.** `navigator.clipboard.writeText` requires HTTPS or `localhost`. Most dashboard deployments meet this (localhost-first design), but a remote-tunnel deployment over plain HTTP would degrade. Mitigation: fall back to selecting the command text so the user can `Cmd-C` manually. Existing project pattern (see `DiagnosticsSection.tsx` copy-to-clipboard with textarea fallback) covers this.

4. **Test coverage for OS-conditional UI.** Vitest/jsdom does not give a real `os.platform()`. The tests pass a mock OS string into the component; integration coverage relies on the manual smoke test in `tasks.md:8.5`.

5. **`bash` resolution on Windows with WSL but no Git-for-Windows.** WSL's bash is at `\\wsl$\<distro>\bin\bash` — not a PATH lookup. The `where` strategy will not find it. Users in this configuration must set an override via Settings → Tools. The `installHints` should mention WSL as a setup option; the UI cannot auto-detect it.

## Rollout

1. Land this proposal (additive — no breaking changes).
2. Smoke-test on the three host OSes per `tasks.md:8.5`.
3. Watch for telemetry / user reports of `MissingToolError` emissions in the first release — the structured-error path is new and may surface edge cases the silent-ENOENT path masked.
4. Schedule the follow-on `deprecate-managed-bin-strategy` and Doctor-integration changes once `fix-doctor-stale-managed-install-check` has landed.
