# useTreeColumnWidth.ts — index

Persisted width + drag lifecycle for the Instructions folder-tree column (peer of `useSidebarState`). Clamp 200–560, key `dashboard:dirset-width`; live width during drag, commits to `localStorage` on mouseup. Returns `{width, containerRef, startResize}`; `localStorage` throw degrades to in-memory. Exports `useTreeColumnWidth`, `TreeColumnWidth`, `MIN_WIDTH`/`MAX_WIDTH`/`DEFAULT_WIDTH`/`WIDTH_KEY`. See change: directory-settings-tree-and-resize.
