# usePiResourceFileFetch.ts — index

Fetches `GET /api/pi-resource-file?path=` into `{ content, isLoading, error }`. Detects source language from extension via `SOURCE_LANG_MAP`, wraps content in fenced code block. Re-fetches on `filePath` change.
