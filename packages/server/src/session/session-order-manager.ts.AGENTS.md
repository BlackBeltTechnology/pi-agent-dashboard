# session-order-manager.ts — index

Per-cwd session ordering persisted via `PreferencesStore`. Exports `SessionOrderManager` interface, `createSessionOrderManager(preferencesStore)`. Methods: `insert`, `reorder`, `remove`, `moveToFront`, `rekey(oldKey,newKey,id,opts)`, `getOrder(cwd,validIds)`, `getAllOrders`. Synchronous mutations.
