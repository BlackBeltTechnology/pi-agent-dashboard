# extract-urls.ts — index

Pure `extractRecentUrls(messages: ChatMessage[]): string[]`. Scans newest→oldest, dedupes preserving newest-first, caps at 50. Regex `\bhttps?://[^\s<>"'\`]+`. Strips trailing `).,;:!?'"` punctuation. Scans both `content` + `result` fields. See change: render-file-previews.

Trailing-punctuation strip is a linear loop (`clean`), not a `/[…]+$/` regex — the regex backtracked quadratically on long `!` runs (CodeQL js/polynomial-redos #217). See change: add-team-skill-access.
