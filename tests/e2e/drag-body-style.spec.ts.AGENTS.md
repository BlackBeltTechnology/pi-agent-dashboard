# drag-body-style.spec.ts — index

Browser E2E for test-plan #F23 (capability `drag-body-style`, change: fix-long-session-ux-degradation §1, design D1). One test: desktop 1280×800, sidebar `drag-handle` mousedown → `document.body.style.cursor === "col-resize"` + `userSelect === "none"`; flip viewport to 375×667 so `App` swaps to the mobile shell and the desktop sidebar unmounts mid-drag → `drag-handle` count 0, body cursor back to `""`, computed `user-select` not `none`, computed cursor not `col-resize`; release pointer → programmatic selection over `header-app-bar` text has length > 0. Only this layer reproduces the breakpoint-driven unmount + real selectability. Use when the drag body-style contract regresses in a real browser.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): #F23 — breakpoint flip unmounts dragger mid-drag; body cursor cleared, text selectable.
