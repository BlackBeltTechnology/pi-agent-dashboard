# session-meta.ts — index

`SessionMeta` sidecar shape + read/write/merge. Adds `originDeviceId?` — origin gates FILESYSTEM READS, so it must outlive the process that derived it; a restart that forgets it resurrects a remote session as local and hydration opens the origin host's path on THIS disk (#E15). Absent = local. See change: serve-retained-remote-transcripts.

`SessionMeta.statsExtractorVersion?` — absent/older than `STATS_EXTRACTOR_VERSION` ⇒ non-archived sidecar re-extracts on discovery regardless of mtime. See change: count-non-message-usage.
