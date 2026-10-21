# session-events-store.ts — index

Module-level per-session `DashboardEvent` side-channel store for plugins. Exports `publishSessionEvent`, `publishSessionEvents` (batch, O(N) not O(N²)), `clearSessionEvents`, `getSessionEvents`, `subscribeSessionEvents` (stable frozen-array refs), `__resetSessionEventsStoreForTests`. Consumed by `useSessionEvents` hook in `plugin-context.tsx`.
