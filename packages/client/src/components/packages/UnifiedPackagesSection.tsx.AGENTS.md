# UnifiedPackagesSection.tsx — index

Exports `UnifiedPackagesSection`. Settings → Packages "Pi Ecosystem" section. Sub-groups Core / Recommended Extensions / Other Packages via `PackageRow`. Installed rows pass `isOverride: isSourceOverride(pkg)` (forwarded through `WhatsNewPackageRow`'s `{...rowProps}` spread) → `override` pill; Update affordance unchanged. Drives core updates via `packageQueue` (NOT a direct fetch), installed-package update checks, `WhatsNewDialog` for pi core changelog. `launchSource === "electron"` hides Core group. Helpers `npmNameFromSource`, `relativeTime`, `isPiCorePkg`, `SubGroupHeader`, `EmptyHint`. See change: flag-package-source-overrides.


## reset-override-to-npm

Installed rows forward `publishedVariantSource/Version` + `onResetToNpm` (\u2192 `operations.resetToNpm(source,{scope:"global"})`) through `WhatsNewPackageRow`\u2019s `{...rowProps}`. Wrapped in a `<div>` that also renders `PackagePartialSuccessBanner` on `moveState.phase==="partial-success"`. See change: reset-override-to-npm.

## unify-pi-core-into-package-queue

Core sub-group holds NO local pi-core state. Removed: `coreUpdating`/`coreProgress`/`coreErrors` `useState`, the `pi-core-event` `useEffect`, the `doCoreUpdate` `useCallback`, the `ProgressMap` type, the `PiCoreUpdateResponse` import.

Core rows now read the singleton `packageQueue` through `usePackageOperations("global")`, keyed by `piCoreSource(pkg.name)` = `pi-core:<scoped-npm-name>`:
`busy = operations.runningSource === opSource`, `progress = busy ? operations.operation.message : undefined`, `error = statusFor(opSource)==="error" ? messageFor(opSource) : undefined`, `onUpdate = () => operations.coreUpdate(pkg.name)`. `WhatsNewDialog`'s CTA routes through `coreUpdate` too.

"Update All" fans out to N single-name enqueues (`updatableCore.forEach(p => operations.coreUpdate(p.name))`) drained FIFO — trade-off: N session reloads instead of 1. Gated by local `queueBusy` (`queueDepth + (runningSource?1:0) > 0`); spinner via `coreUpdateAllSpinning` (queueBusy AND some updatable core row is running/queued).

Version-list refresh after completion comes from `usePiCoreVersions`' own independent `pi_core_update_complete` listener — no inline `refresh(true)` needed.

**D9 rewritten — VISIBLE queue, not disabled buttons.** Governing rule: no enabled click is silently lost. Earlier draft (disable every lock-taking control while any op runs) REVERSED — an inert button and a silently-409ing button are the same defect, and disabling freezes the panel for a multi-minute core update.

- Core + extension row buttons stay ENABLED mid-flight. Click enqueues → row renders `queued` → `running` → result.
- Three non-conflated `PackageRow` signals: `busy` (own-source running → spinner+progress) / `queued` (own-source queued → `queued` pill + "Queued" label + own-button disable) / `locked` (`operations.isAnyRunning` → disables **only** Move + Reset-to-npm, tooltip via `lockedReason`).
- Core "Update All" stays clickable mid-flight; disabled only when `updatableCore.length === 0`. Idempotent via queue's (source, action) dedupe. Local `coreUpdateAllSpinning` = any updatable core row running|queued. The old `queueBusy` gate is GONE.
- Move + Reset-to-npm are the ONLY disabled controls. Reason: they ride `moveTracker` not `packageQueue` — `moveId`-keyed identity + partial-success semantics don't fit source-keyed `statusFor(source)`, so they can't be queued; unqueued they take the busy lock directly with NO 409 retry.

See change: unify-pi-core-into-package-queue.
