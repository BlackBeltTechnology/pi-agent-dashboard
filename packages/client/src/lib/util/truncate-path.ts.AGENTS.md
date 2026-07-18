# truncate-path.ts — index

Pure middle-truncation of filesystem path. Exports `truncatePathMiddle(path, maxLen)`. Preserves leading segments + last segment, replaces middle with `…`. Returns untruncated when too short or budget too small.
