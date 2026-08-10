# extract-urls.ts — index

Pure `extractRecentUrls(messages: ChatMessage[]): string[]`. Scans newest→oldest, dedupes preserving newest-first, caps at 50. Regex `\bhttps?://[^\s<>"'\`]+`. Strips trailing `).,;:!?'"` punctuation. Scans both `content` + `result` fields. See change: render-file-previews.
