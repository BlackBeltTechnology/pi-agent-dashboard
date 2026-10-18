

Dialogs (New / Propose / Explore / attach picker / Tasks) via `lazy-openspec-dialogs` (Suspense). See change: redesign-composer-session-strip.

Resolves attachment via `useAttachmentResolution`; lifecycle UI only for active in own cwd, else `AttachmentTrace` + Detach. See change: resolve-archived-attached-proposal.

Attached-change header shows `OpenSpecErrorBadge` (all variants) when `change.error`; passes `error` into `deriveOpenSpecActions`; reason via `blockedReasonText`. See change: use-openspec-status-all.
