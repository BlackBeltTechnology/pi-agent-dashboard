# server-switch.ts — index

`performServerSwitch(target, deps)` — extracted two-phase transaction (stage → commit) from `App.tsx`'s `handleServerSwitch`. Guarantees ordering `clearInMemoryState` → `setWsUrl` → `persistLastServer`, never persists localStorage or clears state on staging failure. Fully unit-tested.
