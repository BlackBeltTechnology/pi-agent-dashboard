/**
 * `matchTabs` — the pure matcher behind the pane's Search tabs popover.
 *
 * Matches the DISPLAY text of each tab (label + location), never the raw path
 * prefix (`term:`, `diff:`), so typing `term:` does not match every terminal.
 * Whitespace-separated tokens are ANDed; each token may match the label or the
 * location. Folding is per code point (NFD, strip U+0300–U+036F only, then
 * lower-case) with an index map, so highlight ranges address the ORIGINAL
 * string. Letters with no decomposition (`ß`, `ø`, `ł`) and other scripts'
 * combining marks are kept, so distinct words never collide.
 *
 * See change: scope-anchor-editor-pane-controls (D7).
 */

/** Half-open `[start, end)` range over the ORIGINAL string (UTF-16 indices). */
export type HighlightRange = readonly [start: number, end: number];

export interface TabHaystack {
  /** Display label (basename, url, terminal title); `""` when the label is not text (plugin). */
  label: string;
  /** Secondary text (parent folder, `terminal`, `url`, `live`, …). */
  location: string;
}

export interface TabMatch<T extends TabHaystack> {
  tab: T;
  labelRanges: HighlightRange[];
  locationRanges: HighlightRange[];
}

interface Folded {
  text: string;
  /** For each UTF-16 char of `text`: start index of its source code point. */
  from: number[];
  /** For each UTF-16 char of `text`: end index (exclusive) of its source code point. */
  to: number[];
}

const COMBINING_LATIN = /[\u0300-\u036f]/g;

const foldPiece = (cp: string): string => cp.normalize("NFD").replace(COMBINING_LATIN, "").toLowerCase();

function fold(source: string): Folded {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const cp of source) {
    const piece = foldPiece(cp);
    for (let k = 0; k < piece.length; k++) {
      from.push(i);
      to.push(i + cp.length);
    }
    text += piece;
    i += cp.length;
  }
  return { text, from, to };
}

/** Ranges (original indices) of the first occurrence of `token` in `hay`; `null` when absent. */
function findToken(hay: Folded, token: string): HighlightRange | null {
  const at = hay.text.indexOf(token);
  if (at < 0) return null;
  return [hay.from[at], hay.to[at + token.length - 1]];
}

function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Fold + split a query into tokens; `[]` for an empty / whitespace-only query. */
export function queryTokens(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return fold(trimmed).text.split(/\s+/).filter(Boolean);
}

/**
 * Tabs matching `query`, in input (tab-strip) order. An empty query returns
 * every tab with no highlights.
 */
export function matchTabs<T extends TabHaystack>(tabs: readonly T[], query: string): TabMatch<T>[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return tabs.map((tab) => ({ tab, labelRanges: [], locationRanges: [] }));
  const out: TabMatch<T>[] = [];
  for (const tab of tabs) {
    const label = fold(tab.label);
    const location = fold(tab.location);
    const labelRanges: HighlightRange[] = [];
    const locationRanges: HighlightRange[] = [];
    let all = true;
    for (const token of tokens) {
      const inLabel = findToken(label, token);
      if (inLabel) {
        labelRanges.push(inLabel);
        continue;
      }
      const inLocation = findToken(location, token);
      if (inLocation) locationRanges.push(inLocation);
      else {
        all = false;
        break;
      }
    }
    if (all) out.push({ tab, labelRanges: mergeRanges(labelRanges), locationRanges: mergeRanges(locationRanges) });
  }
  return out;
}
