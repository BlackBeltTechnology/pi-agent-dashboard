# wrap-ascii-tables.ts — index

Pre-processes markdown to wrap raw ASCII/box-drawing table blocks in fenced code blocks so they render monospace. Exports `wrapAsciiTables(content)`. Two-pass: marks `isAsciiTableBorder`/`isAsciiDataRow` lines outside existing fences, expands blocks to include sandwiched fixed-width (3+ spaces) annotation lines. Wraps only blocks of 2+ lines.
