

Dialogs via `lazy-openspec-dialogs` (Suspense). See change: redesign-composer-session-strip.

Attachment resolved via `useAttachmentResolution`; `AttachmentTrace` next to the change chip for non-live attachments. See change: resolve-archived-attached-proposal.

`working` prop is fed `isComposerWorking(composerStatus, retry)` by `App.tsx` (shared predicate; ended + retry is not working). See change: fix-composer-liveness-on-reload.

Passes `change.error?.message` to `deriveOpenSpecActions` (Continue/FF `aria-disabled`, focusable, title = message). See change: use-openspec-status-all.
