# i18n Audit — Component Files (comp_0.txt)

Generated: 2026-07-14 | 60 files scanned | Method: ripgrep over JSX text, attributes, error messages, template literals, fallback strings

**Legend:** category is one of: jsx, placeholder, aria, title, alt, toast, error, confirm

| file:line | category | string | hasI18nImport |
|---|---|---|---|
| `packages/client/src/components/ChatView.tsx:158` | title | `Interrupted and steered the current turn` | yes |
| `packages/client/src/components/ChatView.tsx:159` | title | `Queued — delivered after the current turn ends` | yes |
| `packages/client/src/components/ChatView.tsx:162` | jsx | `steered` | yes |
| `packages/client/src/components/ChatView.tsx:162` | jsx | `queued` | yes |
| `packages/client/src/components/BranchSwitchDialog.tsx:33` | error | `Checkout failed` | yes |
| `packages/client/src/components/BranchSwitchDialog.tsx:42` | error | `Checkout failed even after stash` | yes |
| `packages/client/src/components/BranchSwitchDialog.tsx:51` | error | `Stash & checkout failed` | yes |
| `packages/client/src/components/BranchSwitchDialog.tsx:59` | error | `Stash popped with merge conflicts. Please resolve them manually.` | yes |
| `packages/client/src/components/BranchSwitchDialog.tsx:64` | error | `Stash pop failed` | yes |
| `packages/client/src/components/BranchSwitchDialog.tsx:101` | error | `Init failed` | yes |
| `packages/client/src/components/BranchPicker.tsx:38` | error | `Failed to load branches` | yes |
| `packages/client/src/components/BranchCombobox.tsx:111` | jsx | `Select a branch` | yes |
| `packages/client/src/components/ContextUsageBar.tsx:26` | title | `No context data` | no |
| `packages/client/src/components/ContextUsageBar.tsx:26` | title | `${Math.round(pct)}% context used (${tokens.toLocaleString()} / ${contextWindow.toLocaleString()})` | no |
| `packages/client/src/components/FolderActionBar.tsx:111` | title | `code-server not found — click to see install guide` | yes |
| `packages/client/src/components/FolderActionBar.tsx:111` | title | `Editor running — click to open` | yes |
| `packages/client/src/components/FolderActionBar.tsx:111` | title | `Editor starting...` | yes |
| `packages/client/src/components/FolderActionBar.tsx:111` | title | `Open VS Code editor` | yes |
| `packages/client/src/components/ComposerSessionActions.tsx:259` | title | `Session is streaming` | yes |
| `packages/client/src/components/ComposerSessionActions.tsx:396` | title | `Session is streaming` | yes |
| `packages/client/src/components/ComposerSessionActions.tsx:429` | confirm | `Archive` | yes |
| `packages/client/src/components/ChangeSummaryBlock.tsx:40` | jsx | `Changed this turn` | no |
| `packages/client/src/components/ComposerSessionActions.tsx:386` | jsx | `STATUS` | yes |
| `packages/client/src/components/CommitDialog.tsx:188` | error | `No files selected.` | yes |
| `packages/client/src/components/CommitDialog.tsx:189` | error | `Commit message is empty.` | yes |
| `packages/client/src/components/CommitDialog.tsx:190` | error | `A selected path is outside the repository.` | yes |
| `packages/client/src/components/CommitDialog.tsx:191` | error | `Not a git repository.` | yes |
| `packages/client/src/components/CommitDialog.tsx:192` | error | `Staging failed: ${fallback}` | yes |
| `packages/client/src/components/CommitDialog.tsx:193` | error | `Commit failed: ${fallback}` | yes |
| `packages/client/src/components/CommitDialog.tsx:194` | error | `Commit failed.` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:172` | error | `File is not readable as text` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:172` | error | `Failed to load file` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:184` | error | `Network error` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:287` | error | `Write failed` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:287` | error | `Save failed (${status})` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:301` | error | `Network error` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:322` | error | `Could not read current file state` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsPage.tsx:328` | error | `Network error` | yes |
| `packages/client/src/components/DirectorySettings/FilePicker.tsx:157` | error | `Failed to load files` | yes |
| `packages/client/src/components/DirectorySettings/FilePicker.tsx:163` | error | `Network error` | yes |
| `packages/client/src/components/DirectorySettings/InstructionsEditorPane.tsx:115` | jsx | `File changed on disk since you loaded it. Resolve to continue.` | yes |
| `packages/client/src/components/FilePreviewOverlay.tsx:50` | error | `Failed to read file` | yes |
| `packages/client/src/components/FilePreviewOverlay.tsx:93` | error | `Path is not a file` | yes |
| `packages/client/src/components/FilePreviewOverlay.tsx:98` | error | `Network error` | yes |
| `packages/client/src/components/DiffPanel.tsx:77` | error | `Failed to load file` | yes |
| `packages/client/src/components/DiffPanel.tsx:82` | error | `Failed to load file` | yes |
| `packages/client/src/components/ErrorBoundary.tsx:33` | error | `Unknown error` | yes |
| `packages/client/src/components/EditorView.tsx:53` | error | `Failed to start editor` | yes |
| `packages/client/src/components/EditorView.tsx:62` | error | `Network error` | yes |
| `packages/client/src/components/DiagnosticsSection.tsx:167` | error | `Failed to set git source: ${msg}` | yes |
| `packages/client/src/components/DiagnosticsSection.tsx:172` | error | `Failed to set git source: ${e.message}` | yes |
| `packages/client/src/components/DiagnosticsSection.tsx:192` | error | `clipboard unavailable` | yes |
| `packages/client/src/components/CloseWorktreeDialog.tsx:151` | jsx | `Removing…` | yes |
| `packages/client/src/components/CloseWorktreeDialog.tsx:151` | jsx | `Remove worktree` | yes |
| `packages/client/src/components/ArchiveBrowserView.tsx:191` | jsx | `Ungrouped` | yes |
| `packages/client/src/components/ArchiveBrowserView.tsx:282` | jsx | `No matching entries` | yes |
| `packages/client/src/components/ArchiveBrowserView.tsx:282` | jsx | `No archived changes` | yes |
| `packages/client/src/components/FirstLaunchDisplayModal.tsx:22` | jsx | `Simple` | yes |
| `packages/client/src/components/FirstLaunchDisplayModal.tsx:22` | jsx | `Just messages — hide reasoning, tool calls, stats.` | yes |
| `packages/client/src/components/FirstLaunchDisplayModal.tsx:23` | jsx | `Standard` | yes |
| `packages/client/src/components/FirstLaunchDisplayModal.tsx:23` | jsx | `Show tools, results, stats. Hide chain-of-thought.` | yes |
| `packages/client/src/components/FirstLaunchDisplayModal.tsx:24` | jsx | `Show everything` | yes |
| `packages/client/src/components/FirstLaunchDisplayModal.tsx:24` | jsx | `All signals visible, including reasoning and debug.` | yes |
| `packages/client/src/components/CommandInput.tsx:16` | jsx | `Compact session context` | no |
| `packages/client/src/components/CommandInput.tsx:17` | jsx | `Reload extensions, skills, prompts, and themes` | no |
| `packages/client/src/components/CommandInput.tsx:18` | jsx | `Start a new session` | no |
| `packages/client/src/components/CommandInput.tsx:28` | jsx | `Preview a file or URL inline` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:51` | error | `Failed to save Gateway settings` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:62` | jsx | `Gateway` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:63` | jsx | `Expose this dashboard beyond localhost — public proxy or private mesh.` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:91` | jsx | `Trusted networks` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:94` | jsx | `Who may reach the Gateway without signing in is managed on the` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:95` | jsx | `Security` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:98` | jsx | `, shared with the auth system, so they live once, not duplicated here.` | no |
| `packages/client/src/components/Gateway/GatewayPage.tsx:107` | jsx | `Open Security →` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:76` | title | `Gateway` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:110` | jsx | `Who may reach the Gateway without signing in is managed on the` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:111` | jsx | `Security` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:113` | jsx | `page — trusted networks map to` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:114` | jsx | `, shared with the auth system, so they live once (no duplicate here).` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:126` | jsx | `Open Security →` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:143` | error | `disconnect failed` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:150` | jsx | `Disconnect` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:162` | jsx | `Saving…` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:163` | jsx | `Save` | no |
| `packages/client/src/components/Gateway/GatewayDialog.tsx:168` | jsx | `Done` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:70` | title | `Copied!` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:70` | title | `Copy` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:112` | error | `Only https:// or wss:// endpoints are accepted.` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:125` | error | `Failed to add URL` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:131` | jsx | `Accessible at` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:138` | jsx | `No reachable endpoints yet.` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:162` | jsx | `Adding…` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:162` | jsx | `Add HTTPS URL` | no |
| `packages/client/src/components/Gateway/GatewayEndpoints.tsx:173` | jsx | `Add your own reverse-proxy / funnel URL. Only https/wss endpoints ride the pairing QR (D14).` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:95` | aria | `Choose which network the QR encodes` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:159` | jsx | `pairing` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:159` | jsx | `link` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:213` | error | `approval failed` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:228` | jsx | `Device paired: ${approvedLabel}` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:233` | jsx | `Type the confirmation code shown on the device` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:258` | jsx | `Approving…` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:259` | jsx | `Approve` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:299` | error | `failed to load pairing payload` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:331` | jsx | `Connect a device` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:335` | jsx | `· code expired` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:335` | jsx | `· code expires ${secondsLeft}s` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:339` | jsx | `No TLS endpoint to pair over. Start a public tunnel or add an https:// URL — a plain-http LAN address cannot run the secure pairing handshake.` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:358` | jsx | `one-time · ` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:374` | jsx | `Only publicly-trusted TLS endpoints ride in the pairing QR (D14). Select a mesh/LAN row above for a direct link QR; the device must already be on that network.` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:384` | jsx | `Opens the dashboard directly — no pairing, no secret. Access is governed by trusted networks; the device must already be on this network.` | no |
| `packages/client/src/components/Gateway/GatewayPairQR.tsx:393` | jsx | `Regenerate` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:26` | jsx | `funnel · internet` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:27` | jsx | `tailnet / mesh only` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:46` | jsx | `Provider` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:59` | aria | `Gateway provider` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:67` | jsx | `Mode` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:69` | aria | `Gateway mode` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:78` | title | `${meta.label} does not support ${m} mode` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:89` | jsx | `Public` | no |
| `packages/client/src/components/Gateway/GatewayProviderSection.tsx:89` | jsx | `Private` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:67` | jsx | `runs server-side` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:92` | jsx | `Running…` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:93` | jsx | `Done ✓` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:93` | jsx | `Connect` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:93` | jsx | `Authenticate` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:117` | jsx | `Open admin console` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:118` | jsx | `Sign in via browser` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:126` | jsx | `Setup` | no |
| `packages/client/src/components/Gateway/GatewaySetupGuide.tsx:164` | jsx | `Security: auth/activate run a fixed whitelisted recipe keyed by (provider, step) — never a free-form command. Install stays copy-paste (needs elevation).` | no |

## Summary

**Total untranslated strings:** 127
**Files affected:** 26 of 60 scanned
**Gateway files (no i18n import at all):** 6 files — GatewayPage, GatewayDialog, GatewayEndpoints, GatewayPairQR, GatewayProviderSection, GatewaySetupGuide
**Other files with no i18n import:** ContextUsageBar, ChangeSummaryBlock, CommandInput
**Error messages dominate:** ~50+ of the untranslated strings are error/fallback messages (`?? "..."` patterns)

**Category breakdown:**
- **error**: 49 strings (fallback error messages, mostly `?? "..."`)
- **jsx**: 68 strings (visible labels, headings, paragraphs, button text)
- **title**: 12 strings (tooltip/title attributes)
- **aria**: 5 strings (aria-label attributes)
- **confirm**: 1 string (confirmLabel)

**Patterns missed by current i18n coverage:**
1. `?? "..."` fallback strings after server errors — these display to users as error messages
2. `title={...}` attributes with hardcoded strings (e.g., FolderActionBar editor state tooltips)
3. `aria-label` strings (Gateway radio groups)
4. JSX text content in newer components (Gateway module was written without i18n)
5. Display presets data arrays (FirstLaunchDisplayModal OPTIONS) — labels and descriptions
6. Command descriptions in CommandInput (model-level builtin descriptions)
7. Template literal error messages containing variable interpolation (e.g., `Save failed (${status})`)
