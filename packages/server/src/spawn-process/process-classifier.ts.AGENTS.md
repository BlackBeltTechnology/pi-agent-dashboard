# process-classifier.ts — index

Pure process classifier. Enriches scanned `process_list` entries with `kind`, `label`, `sessionRef` by cross-referencing `pid`/`command` against `pidIndex` from connected sessions. Server-side only. Exports `buildPidIndex`, `classifyProcesses`, `RawProcessEntry`, `ClassifiedProcessEntry`, `PidIndex`, `PidIndexEntry`. Restricts index to live sessions (avoids pid-reuse mislinks). See change: classify-process-list-entries.
