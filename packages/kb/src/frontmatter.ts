// Vendored, zero-dependency YAML-subset frontmatter parser + structural routing.
// See change: add-kb-frontmatter-structural-indexing (design D3/D4/D5).
//
// The parser is TOTAL (never throws) and PURE (same bytes → same output). It
// supports a bounded grammar: `key: scalar`, inline `[a, b]`, block `- item`
// lists, bool/int/float, `YYYY-MM-DD`, `#` comments, single/double quotes.
// Unsupported constructs (anchors/aliases, `|`/`>` block scalars, general nested
// maps, merge keys) fall back to string / skip — never a throw. A top-level
// `kb:` key and its indented subtree are consumed and discarded (owned by the
// semantic-annotation plane).

export type FmScalar = string | number | boolean;
export type FmValue = FmScalar | string[];

export interface ParsedFrontmatter {
  body: string; // markdown after the frontmatter block (CRLF-normalized)
  fm: Record<string, FmValue> | null; // null when no/malformed frontmatter
  parseFailed: boolean; // a frontmatter block was present but a line did not parse
}

/** Strip a trailing `# comment`. For a quoted value, keep through the closing
 *  quote and drop any comment after it (`title: "H" # c` → `"H"`). */
function stripComment(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const close = t.indexOf(t[0], 1);
    return close > 0 ? t.slice(0, close + 1) : t; // unterminated quote → leave as-is
  }
  const idx = t.indexOf(" #");
  return (idx >= 0 ? t.slice(0, idx) : t).trim();
}

/** Coerce a bare scalar token to bool/int/float/string. Quoted → string. */
function coerceScalar(raw: string): FmScalar {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/** Parse an inline `[a, b, "c"]` array to a string[] (elements trimmed/unquoted). */
function parseInlineArray(s: string): string[] {
  const inner = s.replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((e) => {
      const t = e.trim();
      const unq = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
      return unq.trim();
    })
    .filter((e) => e.length > 0);
}

const isIndented = (line: string): boolean => /^\s/.test(line);
const isBlank = (line: string): boolean => line.trim() === "";

/** Detect + parse a leading YAML-subset frontmatter block. Total + pure. */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const norm = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); // strip BOM; CRLF/CR → LF
  const lines = norm.split("\n");
  if (lines[0] !== "---") return { body: norm, fm: null, parseFailed: false };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { body: norm, fm: null, parseFailed: false }; // no closing fence → not frontmatter

  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n");
  const fm: Record<string, FmValue> = {};
  let parseFailed = false;

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (isBlank(line) || line.trim().startsWith("#")) continue;
    if (isIndented(line)) continue; // stray indented line without a parent key context
    const m = line.match(/^([A-Za-z0-9_.\/-]+):(.*)$/);
    if (!m) {
      parseFailed = true;
      continue;
    }
    const key = m[1];
    const rest = stripComment(m[2]);

    // Top-level `kb:` — consume + discard its entire indented subtree.
    if (key === "kb") {
      while (i + 1 < fmLines.length && (isIndented(fmLines[i + 1]) || isBlank(fmLines[i + 1]))) i++;
      continue;
    }

    if (rest === "") {
      // block list, nested map, or empty scalar
      const items: string[] = [];
      while (i + 1 < fmLines.length && /^\s*-\s+/.test(fmLines[i + 1])) {
        i++;
        items.push(stripComment(fmLines[i].replace(/^\s*-\s+/, "")).replace(/^["']|["']$/g, ""));
      }
      if (items.length) {
        fm[key] = items.filter((e) => e.length > 0);
      } else if (i + 1 < fmLines.length && /^\s+\S/.test(fmLines[i + 1])) {
        // nested map (unsupported) → skip its indented subtree, emit nothing
        while (i + 1 < fmLines.length && (isIndented(fmLines[i + 1]) || isBlank(fmLines[i + 1]))) i++;
      } else {
        fm[key] = "";
      }
      continue;
    }

    if (rest === "|" || rest === ">") {
      // multiline block scalar (unsupported) → skip its indented subtree
      while (i + 1 < fmLines.length && (isIndented(fmLines[i + 1]) || isBlank(fmLines[i + 1]))) i++;
      continue;
    }

    if (rest.startsWith("[")) {
      fm[key] = parseInlineArray(rest);
      continue;
    }

    fm[key] = coerceScalar(rest);
  }

  return { body, fm, parseFailed };
}

// ── Structural routing (design D5): frontmatter → searchable meta + property rows

export interface FacetKeyConfig {
  key: string;
  type?: "string" | "number" | "date";
}

/** Default routing (superset of prior behavior: `tags` still drives has_tag). */
export const DEFAULT_SEARCHABLE_KEYS: string[] = ["title", "description", "aliases", "keywords"];
export const DEFAULT_FACET_KEYS: FacetKeyConfig[] = [
  { key: "tags" },
  { key: "status" },
  { key: "author" },
  { key: "category" },
  { key: "date", type: "date" },
];

export interface PropertyRow {
  key: string;
  value: string; // normalized: lowercased + trimmed (filters/facets match this)
  valueNum: number | null; // set only for declared-numeric keys with a strict match
  valueDate: string | null; // set only for declared-date keys, canonical YYYY-MM-DD
  valueRaw: string; // original, for display
}

/** Strict full-match numeric coercion; null when not a clean, finite number
 *  (a very long digit string parses to Infinity — rejected). */
export function strictNumber(v: FmValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Strict `YYYY-MM-DD` calendar date; null otherwise. Rejects impossible dates
 *  (e.g. `2024-02-31`) via a UTC round-trip. Instants deferred — design D3. */
export function strictDate(v: FmValue): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Build the searchable meta pieces: title (→ heading) and the rest (→ body).
 *  `tags` is never searchable (it is a facet). */
export function buildMeta(fm: Record<string, FmValue>, searchableKeys: string[]): { title: string | null; body: string } {
  const title = searchableKeys.includes("title") && fm.title != null ? String(Array.isArray(fm.title) ? fm.title.join(" ") : fm.title) : null;
  const parts: string[] = [];
  for (const key of searchableKeys) {
    if (key === "title" || key === "tags") continue;
    const v = fm[key];
    if (v == null) continue;
    parts.push(Array.isArray(v) ? v.join(" ") : String(v));
  }
  return { title, body: parts.join(" ").trim() };
}

/** Build de-duplicated property rows for the whitelisted facet keys.
 *  Array values → one row per distinct element; within-file duplicates collapse. */
export function buildProperties(fm: Record<string, FmValue>, facetKeys: FacetKeyConfig[]): PropertyRow[] {
  const rows: PropertyRow[] = [];
  for (const { key, type } of facetKeys) {
    const v = fm[key];
    if (v == null) continue;
    const elems: FmScalar[] = Array.isArray(v) ? v : [v];
    const seen = new Set<string>();
    for (const e of elems) {
      const raw = String(e);
      const value = raw.toLowerCase().trim();
      if (value === "" || seen.has(value)) continue;
      seen.add(value);
      rows.push({
        key,
        value,
        valueNum: type === "number" ? strictNumber(e) : null,
        valueDate: type === "date" ? strictDate(raw) : null,
        valueRaw: raw,
      });
    }
  }
  return rows;
}
