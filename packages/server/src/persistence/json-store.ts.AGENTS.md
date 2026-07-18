# json-store.ts — index

Atomic JSON file read/write helpers. Exports `readJsonFile(filePath, fallback)` (returns fallback on missing/invalid) and `writeJsonFile(filePath, data)` (write-tmp + rename, mkdir parent). Crash-safe.
