# server-switch.ts — index

`performServerSwitch(target, deps)` — extracted two-phase transaction (stage → commit) from `App.tsx`'s `handleServerSwitch`. Guarantees ordering `clearInMemoryState` → `setWsUrl` → `persistLastServer`, never persists localStorage or clears state on staging failure. Fully unit-tested.

Also exports `LAST_SERVER_KEY` and `getInitialWsUrl()` (moved from `App.tsx`): saved remote → ws URL, but own origin when the Electron open-server-window capability is present (saved value left untouched). See change: add-electron-server-windows (D13).
