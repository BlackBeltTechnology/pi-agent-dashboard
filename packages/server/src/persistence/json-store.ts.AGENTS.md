# json-store.ts — index

Atomic JSON file read/write helpers. Exports `readJsonFile(filePath, fallback)` (returns fallback on missing/invalid) and `writeJsonFile(filePath, data)` (write-tmp + rename, mkdir parent). Crash-safe.

`writeJsonFile(filePath, data, opts?: {mode})`: with `mode`, `.tmp` written with mode then `chmodSync` UNCONDITIONALLY before rename (stale 0644 tmp cannot leak). Existing callers unchanged. See change: add-server-push-notifications.
