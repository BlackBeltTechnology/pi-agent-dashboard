# DOX — packages/client/src/components/primitives

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `ActionButton.tsx` | `<ActionButton action options pendingLabel>` thin wrapper over `useAsyncAction.bind`. → see `ActionButton.tsx.AGENTS.md` |
| `CopyButton.tsx` | Clipboard copy button with copied-state check icon. Exports `CopyButton`. Calls `navigator.clipboard.writeText`; resets state after 1500ms. Fails silently when Clipboard API unavailable. |
| `DialogPortal.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/DialogPortal`. Symbol moved in change `complete-flows-plugin-migration` (Layer 0). |
| `ErrorBoundary.tsx` | Generic React error boundary. Exports `ErrorBoundary`. Catches render errors via `getDerivedStateFromError`;… → see `ErrorBoundary.tsx.AGENTS.md` |
| `InlineRenameInput.tsx` | Autofocusing inline text input for rename. Enter → `onConfirm(trim)`, Escape/blur → `onCancel`; `confirmedRef` guards double-fire. Exports `InlineRenameInput`. |
| `PathPicker.tsx` | Reusable keyboard-first path picker with typeahead directory list. → see `PathPicker.tsx.AGENTS.md` |
| `PiLogo.tsx` | Inline SVG brand mark (geometric Π). Exports `PiLogo`. Props: `size` (default 24), `className`, `title`. → see `PiLogo.tsx.AGENTS.md` |
| `SearchableSelectDialog.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/SearchableSelectDialog`. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `Toast.tsx` | Canonical `ToastVariant = error\|warning\|success\|info\|neutral` (re-exported by `useAsyncAction`,… → see `Toast.tsx.AGENTS.md` |
