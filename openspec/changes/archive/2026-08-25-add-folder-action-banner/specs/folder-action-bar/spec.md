## REMOVED Requirements

### Requirement: Folder action bar layout

**Reason**: The requirement mandates a component that no longer exists. It places `FolderActionBar` on the git row (`ml-auto`, right-grouped) and mandates its contents "in order: the Initialize control … and `Clean up broken (N)`". Both controls have left the row — initialization to the tier-0 banner, cleanup to the folder actions menu — and the component is deleted, so the layout it describes is unreachable.

**Migration**: The git row's facts-only composition is now specified by `sidebar-folder-header` → "Folder header uses gutter + content two-column layout"; the initialization controls by `folder-action-banner`; the cleanup action by `folder-actions-menu`. The bar's exclusion list (no Directory Settings control, no Terminals/Editor/`+Session`/`+Worktree` buttons) is preserved by those specs plus the surviving spawn-button requirements in this capability.

### Requirement: Initialize button gated on worktree-init status

**Reason**: The hook-run control leaves the git row for the tier-0 banner. Its gating, trust dialog, progress chip and failure/retry behaviour are re-stated by `folder-action-banner`; keeping this requirement would mandate the same control in two places.

**Migration**: Behaviour is preserved — see `folder-action-banner` → "Calls to action render in a full-width tier-0 banner" and "Hook re-trust banners; template drift does not". The hook-run gating semantics themselves (`needsInit`, `trusted`, lazy fail-open probe) are unchanged and remain specified by `worktree-init-hook`.

### Requirement: Initialize button routes unconfigured directories to project-init

**Reason**: Falsified by the per-artifact setup checklist. This requirement mandates `{ hasHook: false, configured: true }` → "the row SHALL render NO initialize control of either kind — there is nothing to initialize", which is precisely the partially-set-up state the user must be able to act on. It also mandates the control in the row rather than the banner.

**Migration**: Replaced by `folder-action-banner` → "Banner reflects the per-artifact setup state", which keeps the project-init spawn behaviour (interactive session, cwd = the directory, project-init skill pre-injected) and makes it reachable in the partial state. `ProjectInitButton` is deleted with the bar.
