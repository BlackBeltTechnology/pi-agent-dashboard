# knip-baseline.json — index

(repo root) Knip dead-code baseline. Per-class counts measured 2026-10-12: files 4, exports 231, types 189, duplicates 12, enumMembers 0 (prior 2026-08-13: files 10, exports 234, types 193, duplicates 12, enumMembers 0).
Lowered, never raised. Cleanup (close-e2e-tooling-followups):
- 6 config-gap files rooted/ignored.
- 5 dead files deleted: `packages/client/src/hooks/useAuthStatus.ts`, `components/diff/DraggableChangeRow.tsx`, `components/terminal/TerminalCard.tsx`, `lib/chat/prompt-component-registry.ts` (shim), `packages/electron/src/lib/ensure-windows-path.ts` (shim).
- Duplicate aliases dropped: `EmlPreview` default export, `PdfPreview` named export (default kept for lazy chunk).
- 10 exports un-exported: `plugin-row-parts.tsx` `ERR_*`/`OK_*`; `useTreeColumnWidth.ts` `MIN_WIDTH`/`MAX_WIDTH`/`DEFAULT_WIDTH`/`WIDTH_KEY`.
- Kept uncertain (4 files): `DiffView.tsx` (theme-token guard G12 pins it); `FlowsCommandRoutes.tsx` (deliberately retained, `scripts/i18n-lint.mjs` DEAD_CODE); `lib/chat/message-queue.ts` (spec `offline-outgoing-message-queue`); `electron/src/lib/lock-metadata.ts` (spec `instance-coordination`).
`--check-baseline-diff origin/develop` → "no baseline class was raised".
See change: close-e2e-tooling-followups.
Debt ceiling, not target. Read by `scripts/knip-ratchet.mjs`.
Per-class on purpose: scalar total lets deleted file pay for two new dead exports.
Raising class rejected by `knip-ratchet.mjs --check-baseline-diff <ref>`; lowering always allowed. Missing file = hard error, never implicit adoption of current counts. See change: add-knip-dead-code-oracle.
