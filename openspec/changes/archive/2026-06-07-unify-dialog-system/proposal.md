# Proposal: unify-dialog-system

> **Revised 2026-06-06.** The original proposal (2026-05-02) predates three
> changes that reshaped where shared UI lives and how plugins consume it:
> `extract-minimal-chat-view` / `complete-flows-plugin-migration` (moved
> shared client UI into `packages/client-utils`) and
> `add-plugin-ui-primitive-registry` (plugins now resolve host components at
> runtime via `useUiPrimitive(key)` instead of importing client internals).
> This revision re-targets the work onto that architecture and re-enumerates
> the dialogs and call sites that exist today.

## Why

The dashboard accumulated three generations of dialog code, each layered on the
next without retiring the previous one. The result is visually inconsistent
(three overlay tints — `var(--bg-overlay)`, `bg-black/50`, `bg-black/60`; two
confirm-button colors; two container backgrounds; two z-index layers — `z-50`
and `z-[60]`) and behaviourally inconsistent (only some dialogs lock body
scroll, only some respond to `Esc`, click-outside is implemented two different
ways, none trap focus). Multiple near-identical confirmation dialogs
(`ConfirmDialog`, `JjForgetConfirmDialog`, `JjFoldBackDialog`,
`FlowLaunchDialog`'s confirm step, `MergeConfirmDialog`,
`PackageInstallConfirmDialog`) exist as copy-paste descendants because the
shared primitive is too narrow to extend.

We want a single dialog primitive that owns the cross-cutting concerns
(portal, overlay, scroll-lock, `Esc`, click-outside, focus management, ARIA,
z-index) and a thin `Confirm` preset built on top of it, so call sites stop
reimplementing chrome and the look-and-feel converges — **without breaking the
existing UI-primitive registry contract that plugins depend on.**

## Current landscape (verified 2026-06-06)

Shared dialog primitives now live in `packages/client-utils`. The
`packages/client/src/components/ConfirmDialog.tsx` file is a re-export shim
pointing at `@blackbelt-technology/pi-dashboard-client-utils/ConfirmDialog`.
`ConfirmDialog`, `DialogPortal`, and `SearchableSelectDialog` are **registered
as UI primitives** (`ui:confirm-dialog`, `ui:dialog-portal`,
`ui:searchable-select-dialog`) in `packages/client/src/main.tsx`, and plugins
consume them via `useUiPrimitive(UI_PRIMITIVE_KEYS.*)`. The primitive contracts
live in `packages/shared/src/dashboard-plugin/ui-primitives.ts`.

Chrome audit of every dialog:

| Dialog | Location | Overlay | z | Esc | Portal | Era |
|---|---|---|---|---|---|---|
| `ConfirmDialog` | client-utils | `--bg-overlay` | `z-[60]` | no | no | 1 |
| `JjForgetConfirmDialog` | jj-plugin | (Era-1 clone) | — | no | no | 1 |
| `JjFoldBackDialog` | jj-plugin | (Era-1 clone) | — | no | no | 1 |
| `FlowLaunchDialog` (confirm step) | flows-plugin | via `ui:dialog-portal` | — | — | yes | 1/3 |
| `BranchSwitchDialog` | client | `bg-black/50` | `z-50` | no | yes | 2 (blue) |
| `GroupedAttachDialog` | client | `bg-black/50` | `z-50` | — | yes | 2 (blue) |
| `NewChangeDialog` | client | `--bg-overlay` | `z-[60]` | yes | no | 2 |
| `PinDirectoryDialog` | client | `--bg-overlay` | `z-[60]` | no | no | 2 |
| `ExploreDialog` | client | `--bg-overlay` | `z-[60]` | yes | no | 2 |
| `NewWorkspaceDialog` | client | `--bg-overlay` | `z-[60]` | yes | no | 2 |
| `WorktreeSpawnDialog` | client | `--bg-overlay` | `z-[60]` | yes | no | 2 |
| `CloseWorktreeDialog` | client | `--bg-overlay` | `z-[60]` | no | yes | 2 |
| `MergeConfirmDialog` | client | `--bg-overlay` | `z-[60]` | no | yes | 2 |
| `SearchableSelectDialog` | client-utils | `--bg-overlay` | `z-[60]` | yes | yes | 2 |
| `PackageInstallConfirmDialog` | client | `bg-black/60` | `z-50` | yes | yes | 3 |
| `PackageReadmeDialog` | client | `bg-black/60` | `z-50` | yes | yes | 3 |
| `QrCodeDialog` | client | `bg-black/60` | `z-50` | yes | yes | 3 |
| `WhatsNewDialog` | client | `bg-black/60` | `z-50` | yes | yes | 3 |

Out of scope: `interactive-renderers/ConfirmRenderer.tsx` is an inline
tool-call renderer, not a modal dialog — it is not migrated here.

## What Changes

- **Add `Dialog` primitive** in `packages/client-utils` (next to the existing
  `DialogPortal`), exposing `<Dialog open onClose title icon size testId>` plus
  `Dialog.Footer`, `Dialog.Cancel`, `Dialog.Action` (with `intent="primary" |
  "danger" | "neutral"`). The primitive owns: portal (via `DialogPortal`),
  overlay, body scroll lock, `Esc` to dismiss, click-outside, focus trap +
  restore, `role="dialog"` / `aria-modal` / `aria-labelledby`, and a single
  z-index policy (`z-[60]`).
- **Add `Confirm` preset** in `packages/client-utils`
  (`<Confirm open onClose title message body confirmLabel intent onConfirm />`)
  implemented on top of `Dialog`.
- **Re-skin the registered `ui:confirm-dialog` primitive** so plugins inherit
  the unified look-and-feel **without a contract change**: the existing narrow
  contract (`{ message, confirmLabel?, onConfirm, onCancel }`) is preserved, and
  the registered implementation becomes a thin adapter rendering the new
  `Confirm`/`Dialog`. Adding optional props is non-breaking per the registry's
  own rules; renaming `onCancel`/required `title` would be breaking and is NOT
  done. (See design.md D1/D2 for the contract decision.)
- **Register the new shell as `ui:dialog`** (new, additive registry key) so
  plugins like `FlowLaunchDialog` can adopt the shell instead of hand-wiring
  `ui:dialog-portal`. Plugin migration to `ui:dialog` is optional follow-up.
- **Migrate Era-1 confirmations** to `Confirm`: host call sites of
  `ConfirmDialog`, `JjForgetConfirmDialog`, `JjFoldBackDialog`,
  `FlowLaunchDialog`'s confirm step. Delete the per-dialog copy-paste files.
- **Migrate Era-3 dialogs** (`PackageInstallConfirmDialog`,
  `PackageReadmeDialog`, `QrCodeDialog`, `WhatsNewDialog`) to use the `Dialog`
  shell — they already have most of the right behaviour but reimplement it ad
  hoc.
- **Migrate Era-2 dialogs** (`BranchSwitchDialog`, `GroupedAttachDialog`,
  `NewChangeDialog`, `PinDirectoryDialog`, `ExploreDialog`, `NewWorkspaceDialog`,
  `WorktreeSpawnDialog`, `CloseWorktreeDialog`, `MergeConfirmDialog`,
  `SearchableSelectDialog`) to the `Dialog` shell, preserving each dialog's
  internal step / search state.
- **BREAKING (visual):** unify overlay (`bg-black/60`), container background
  (`--bg-primary`), z-index (`z-[60]`), button intents. Era-1 dialogs gain a
  header and lose the always-red confirm button (red reserved for
  `intent="danger"`). Era-2 dialogs switch from `blue-600`/`bg-black/50` to
  `accent-primary`/`bg-black/60`.
- **Retire** the `ConfirmDialog.tsx` shim re-export, the real
  `client-utils/src/ConfirmDialog.tsx` is folded into `Confirm`, and
  `JjForgetConfirmDialog.tsx` / `JjFoldBackDialog.tsx` after migration.
- **Keep** `DialogPortal` as the internal building block of the new shell; its
  existing spec (`dialog-portal`) is unchanged.

## Capabilities

### New Capabilities
- `dialog-system`: the unified `Dialog` primitive — portal, overlay,
  scroll-lock, `Esc`, click-outside, focus management, ARIA, z-index policy,
  size variants, header / footer slots, `intent`-based action buttons.
- `confirm-dialog`: the `Confirm` preset built on `dialog-system` —
  title + message + confirm/cancel with `intent`.

### Modified Capabilities
- `dialog-portal`: no requirement changes (already covers portal + scroll
  lock); the new `Dialog` consumes it. Note only — no delta spec required.

## Impact

- **Affected code:**
  - `packages/client-utils/src/Dialog.tsx` (new), `Confirm.tsx` (new),
    `useFocusTrap.ts` (new)
  - `packages/client-utils/src/ConfirmDialog.tsx` (folded into `Confirm` /
    retained as adapter for `ui:confirm-dialog`)
  - `packages/client/src/components/ConfirmDialog.tsx` (shim — deleted)
  - `packages/client/src/main.tsx` (re-skin `ui:confirm-dialog`, register
    `ui:dialog`)
  - `packages/shared/src/dashboard-plugin/ui-primitives.ts` (add `ui:dialog`
    key + `UiDialogProps` contract; `ui:confirm-dialog` contract unchanged)
  - Era-3 migrated: `PackageInstallConfirmDialog`, `PackageReadmeDialog`,
    `QrCodeDialog`, `WhatsNewDialog`
  - Era-2 migrated: `BranchSwitchDialog`, `GroupedAttachDialog`,
    `NewChangeDialog`, `PinDirectoryDialog`, `ExploreDialog`,
    `NewWorkspaceDialog`, `WorktreeSpawnDialog`, `CloseWorktreeDialog`,
    `MergeConfirmDialog`, `SearchableSelectDialog`
  - Plugin dialogs migrated: `JjForgetConfirmDialog`, `JjFoldBackDialog`,
    `FlowLaunchDialog` confirm step
  - Host `ConfirmDialog` call sites: `App`, `ComposerSessionActions`,
    `FolderActionBar`, `OpenSpecGroupManager`, `SessionOpenSpecActions` (×3),
    `WorktreeInitButton`, `extension-ui/GenericExtensionDialog`
  - Plugin `useUiPrimitive(confirmDialog)` call sites:
    `flows-plugin/SessionFlowActions`, `flows-plugin/FlowsCommandRoutes` —
    **no edits needed** (registry contract preserved), they inherit new look.
- **Registry boundary:** `ui:confirm-dialog` contract stays narrow; the rich
  `Confirm`/`Dialog` API is host-facing via the `client-utils` export and the
  additive `ui:dialog` key. No breaking change for installed plugins.
- **Visual regression:** unifying overlay/container/button/z-index styles
  causes small visual deltas on every existing dialog. No layout changes.
- **A11y improvement:** focus trap + restore + `role="dialog"` / `aria-modal`
  become consistent across all dialogs.
- **No protocol or server changes.** Pure client refactor.

## Open Questions

Resolved in `design.md`:

1. **Location of the new primitive** → `packages/client-utils` (the shared UI
   package now exists; D1).
2. **Plugin contract** → preserve narrow `ui:confirm-dialog`, add additive
   `ui:dialog`; no plugin edits required (D1).
3. **Visual direction** → Era-3 baseline wins (D2).
4. **A11y scope for v1** → focus-trap + ARIA shipped in first cut (D4).
5. **Stacked dialogs** → single fixed layer `z-[60]`, no stack counter (D3).
6. **Imperative `confirm()` API** → out of scope; declarative shape leaves room.
