# update-notifier.ts — index

Native OS update notifications via Electron `Notification`. Exports `notifyUpdatesAvailable(packages, starter)` — shows once per cycle, "Update" action triggers `updatePackage` loop + confirm dialog. `dismissed` flag resets after 24h.
