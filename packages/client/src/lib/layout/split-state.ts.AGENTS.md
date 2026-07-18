# split-state.ts — index

Per-session split state (`mode:"closed"|"split"|"full"`,`ratio`,`orientation`), localStorage key `pi-dashboard:split:<id>`. `clampRatio` [0.25,0.75]. `useSplitState` hook. `loadSplitState` migrates legacy `open` boolean (mode wins over open; open:true→split/false→closed) + clamps ratio; strip-on-write drops `open`. Best-effort read/write. See change: split-editor-workspace. See change: editor-layout-modes.
