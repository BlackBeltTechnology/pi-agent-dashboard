/**
 * Box-drawing and table-related Unicode characters.
 * Covers light, heavy, and double-line box drawing.
 */
const BOX_DRAWING_CHARS = /[─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬]/g;


/**
 * Plain ASCII table border pattern: +---+---+
 */
const ASCII_TABLE_PATTERN = /^\s*\+[-=+]+\+\s*$/;

/**
 * Plain ASCII table data row: starts with | (trailing | optional to handle broken rows)
 */
const ASCII_DATA_ROW = /^\s*\|.+/;

/**
 * Check if a line looks like an ASCII/box-drawing table border or structure.
 * Requires 2+ box-drawing characters, OR matches +---+ pattern.
 */
function isAsciiTableBorder(line: string): boolean {
  if (ASCII_TABLE_PATTERN.test(line)) return true;
  const matches = line.match(BOX_DRAWING_CHARS);
  return matches != null && matches.length >= 2;
}

/**
 * Check if a line looks like a data row inside a plain ASCII table.
 */
function isAsciiDataRow(line: string): boolean {
  return ASCII_DATA_ROW.test(line);
}

/**
 * Check if a line appears to be part of a fixed-width layout.
 * Lines with 3+ consecutive spaces suggest column-aligned content
 * (labels, annotations, arrows placed relative to table columns).
 */
function isFixedWidthLine(line: string): boolean {
  return /   /.test(line) && line.trim().length > 0;
}

/**
 * Pre-process markdown content to wrap ASCII/box-drawing table blocks
 * in fenced code blocks, ensuring they render in monospace font.
 *
 * Uses a two-pass approach:
 * 1. Mark lines that are ASCII table borders/data rows
 * 2. Expand blocks to include sandwiched non-table lines that appear
 *    to be part of a fixed-width layout (labels, annotations between
 *    horizontally-arranged tables)
 *
 * Skips content already inside fenced code blocks.
 * Requires 2+ lines in a block to wrap.
 */
export function wrapAsciiTables(content: string): string {
  const lines = content.split("\n");

  // Pass 1: Mark code fences and table lines
  const inFence: boolean[] = new Array(lines.length).fill(false);
  const isTable: boolean[] = new Array(lines.length).fill(false);
  let fenceOpen = false;
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) {
      fenceOpen = !fenceOpen;
      inFence[i] = true;
      inBlock = false;
      continue;
    }
    if (fenceOpen) {
      inFence[i] = true;
      continue;
    }

    if (isAsciiTableBorder(lines[i])) {
      isTable[i] = true;
      inBlock = true;
    } else if (inBlock && isAsciiDataRow(lines[i])) {
      isTable[i] = true;
    } else {
      inBlock = false;
    }
  }

  // Pass 2: Expand blocks to include sandwiched fixed-width lines.
  // A non-table line between two table lines (within a small gap)
  // that looks like fixed-width content gets included in the block.
  const inBlock2: boolean[] = [...isTable];

  for (let i = 0; i < lines.length; i++) {
    if (inFence[i] || isTable[i]) continue;
    if (!isFixedWidthLine(lines[i])) continue;

    // Look for table lines above and below (within gap of 2 lines)
    let hasTableAbove = false;
    let hasTableBelow = false;

    for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
      if (inFence[j]) break;
      if (isTable[j] || inBlock2[j]) { hasTableAbove = true; break; }
      if (!isFixedWidthLine(lines[j]) && lines[j].trim().length > 0) break;
    }

    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) {
      if (inFence[j]) break;
      if (isTable[j]) { hasTableBelow = true; break; }
      if (!isFixedWidthLine(lines[j]) && lines[j].trim().length > 0) break;
    }

    if (hasTableAbove && hasTableBelow) {
      inBlock2[i] = true;
    }
  }

  // Also include fixed-width lines immediately before or after a table block
  // (headers above, annotations below)
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i] || inBlock2[i]) continue;
    if (!isFixedWidthLine(lines[i])) continue;

    // Check if next non-empty line is a table line (header above table)
    if (i + 1 < lines.length && inBlock2[i + 1]) {
      inBlock2[i] = true;
      continue;
    }

    // Check if previous non-empty line is a table line (annotation below table)
    if (i - 1 >= 0 && inBlock2[i - 1]) {
      inBlock2[i] = true;
    }
  }

  // Pass 3: Collect contiguous blocks and wrap them
  const result: string[] = [];
  let blockLines: string[] = [];

  function flushBlock() {
    if (blockLines.length >= 2) {
      result.push("```");
      result.push(...blockLines);
      result.push("```");
    } else {
      result.push(...blockLines);
    }
    blockLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    if (inBlock2[i]) {
      blockLines.push(lines[i]);
    } else {
      if (blockLines.length > 0) {
        flushBlock();
      }
      result.push(lines[i]);
    }
  }

  if (blockLines.length > 0) {
    flushBlock();
  }

  return result.join("\n");
}
