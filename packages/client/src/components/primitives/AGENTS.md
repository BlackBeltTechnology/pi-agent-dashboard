# DOX — packages/client/src/components/primitives

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `ActionButton.tsx` | `<ActionButton action options pendingLabel>` thin wrapper over `useAsyncAction.bind`. → see `ActionButton.tsx.AGENTS.md` |
| `CopyButton.tsx` | Clipboard copy button with copied-state check icon. Exports `CopyButton`. Calls `navigator.clipboard.writeText`; resets state after 1500ms. Fails silently when Clipboard API unavailable. Optional `testId` prop (See change: redesign-directory-card). |
| `DialogPortal.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/DialogPortal`. Symbol moved in change `complete-flows-plugin-migration` (Layer 0). |
| `ErrorBoundary.tsx` | Generic React error boundary. Exports `ErrorBoundary`. Catches render errors via `getDerivedStateFromError`;… → see `ErrorBoundary.tsx.AGENTS.md` |
| `InlineMessage.tsx` | Shared severity-styled inline surface. Exports `InlineMessage`, `Severity`. Left accent bar + icon + title + optional body/actions + `mdiClose` dismiss; colors from `--severity-{error,warning,info,success}-*` tokens only. `variant="compact"` (one-line), `animate` (amber top sweep). Backs `SpawnErrorBanner`/`SessionBanner`/`MissingToolInlineError`/`NotifyRenderer`. `Severity` gained `"success"`, resolving the pre-existing `--severity-success-*` triple already consumed by `Toast.tsx`/`ToastSlot.tsx` (this is NOT that triple's first consumer). See changes: redesign-directory-card, gate-notify-rows-by-level. |
| `InlineRenameInput.tsx` | Autofocusing inline text input for rename. Enter → `onConfirm(trim)`, Escape/blur → `onCancel`; `confirmedRef` guards double-fire. Exports `InlineRenameInput`. |
| `LogBlock.tsx` | Shared monospace log/stderr inset panel. Exports `LogBlock`. Labelled header + copy (always FULL text) + collapse/expand or `preview` (last-N lines) mode; bounded `maxHeightClass` scroll; empty/whitespace text → renders nothing. Registered as UI primitive `ui:log-block` (main.tsx) for the flows-plugin code-node log preview. See change: redesign-directory-card. |
| `PathPicker.tsx` | Reusable keyboard-first path picker with typeahead directory list. → see `PathPicker.tsx.AGENTS.md` |
| `PiLogo.tsx` | Inline SVG brand mark (geometric Π). Exports `PiLogo`. Props: `size` (default 24), `className`, `title`. → see `PiLogo.tsx.AGENTS.md` |
| `SearchableSelectDialog.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/SearchableSelectDialog`. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `Toast.tsx` | Canonical `ToastVariant = error\|warning\|success\|info\|neutral` (re-exported by `useAsyncAction`,… → see `Toast.tsx.AGENTS.md` |
