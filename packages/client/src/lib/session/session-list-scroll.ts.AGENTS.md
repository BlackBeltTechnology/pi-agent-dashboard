# session-list-scroll.ts — index

Pure helper producing stable scroll-fingerprint of selected session card's position-affecting state. Exports `selectedCardScrollFingerprint(selectedId, sessions, sessionOrderMap)` → `string|null`. Changes iff `status`/`hidden`/`cwd`/order-index change; returns `null` when no selection or selection filtered out. Consumer must separately suppress scroll on `selectedId` change (user click). See change: auto-scroll-selected-session-card.
