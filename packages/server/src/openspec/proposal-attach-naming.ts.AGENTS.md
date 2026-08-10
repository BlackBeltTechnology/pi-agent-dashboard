# proposal-attach-naming.ts — index

Pure helpers for idempotent attach/detach auto-rename rule. Exports `isNameAutoSetFromAttachment`, `attachRenameTarget`, `detachShouldClearName`. Auto-rename on attach when name empty/whitespace OR name === `attachedProposal` (witness); revert on detach only when name === `attachedProposal`. See change: fix-mobile-attach-proposal-display.
