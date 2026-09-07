// AsciiDoc structural chunker — sibling of the markdown chunker (design D3).
// Line-based with a delimited-block state machine: a `== Title`-shaped line is a
// section boundary ONLY outside a delimited block. Shares the markdown chunker's
// thresholds + id/hash scheme (chunk-contract parity), but NOT its oversize
// splitter: the markdown splitter breaks at any blank line, which would split
// mid-listing. Here a split point must sit outside every delimited block.
// Parser is TOTAL (never throws) and PURE (same bytes → same output).
// See change: asciidoc-support.
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, sha } from "./chunker.js";
import type { FmValue } from "./frontmatter.js";
import type { Chunk, DocType } from "./types.js";

export interface AdocChunkInput {
  root: string;
  path: string; // relative
  text: string;
  docType?: DocType;
}

export interface AdocParseResult {
  chunks: Chunk[];
  /** Document header attributes as a key/value map, or null when the document
   *  has no `= Title` header. Negated entries (`:!name:`) carry `NEGATED`. */
  attributes: Record<string, string> | null;
  doctitle: string | null;
  /** Attribute map + `title: <doctitle>`, shaped for the frontmatter meta path
   *  the indexer already applies to markdown (design D3b). */
  frontmatter: Record<string, FmValue> | null;
  wikilinks: string[]; // always empty — AsciiDoc has no `[[wiki]]` convention
  /** Outbound document links from `xref:`/`<<>>` refs (design D6). Fed into the
   *  same file-level link aggregation as markdown links. */
  mdLinks: string[];
  parseFailed: boolean; // always false — the header grammar has no failure mode
}

/** Value stored for a negated attribute entry (`:!sectnums:` / `:sectnums!:`). */
export const NEGATED = "!";

const ADOC_EXT_RE = /\.(adoc|asciidoc)$/i;
/** One to six `=` followed by whitespace and title text. Seven `=` never
 *  matches (the 7th char is not whitespace at any backtrack length). */
const TITLE_RE = /^(={1,6})\s+(\S.*?)\s*$/;
const ATTR_RE = /^:(!?)([A-Za-z0-9_][A-Za-z0-9_-]*)(!?):(?:[ \t]+(.*?))?[ \t]*$/;

/** Canonical delimiter token for a delimited-block boundary line, else null.
 *  A block closes only on a line with the SAME canonical token, so any other
 *  delimiter inside it is opaque content. */
function delimiterOf(line: string): string | null {
  const t = line.replace(/[ \t]+$/, "");
  if (/^\/{4,}$/.test(t)) return "////"; // comment
  if (/^-{4,}$/.test(t)) return "----"; // listing
  if (/^\.{4,}$/.test(t)) return "...."; // literal
  if (/^={4,}$/.test(t)) return "===="; // example
  if (/^\*{4,}$/.test(t)) return "****"; // sidebar
  if (/^_{4,}$/.test(t)) return "____"; // quote
  if (/^\+{4,}$/.test(t)) return "++++"; // passthrough
  if (/^\|={3,}$/.test(t)) return "|==="; // table
  if (t === "--") return "--"; // open
  return null;
}

interface Section {
  headingPath: string;
  heading: string;
  level: number;
  parentChunkId: string | null;
  headingLine: number; // 1-based line of the title (or of the first body line)
  bodyLines: string[];
  lineNos: number[]; // absolute 1-based source line per body line
}

const bodyOf = (s: Pick<Section, "bodyLines">): string => s.bodyLines.map((l) => l + "\n").join("");

/** Parse the document header: `= Title` on line 1 plus the `:name: value`
 *  entries that follow it, up to the first blank or non-attribute line. */
function parseHeader(lines: string[]): { doctitle: string | null; attributes: Record<string, string> | null; bodyStart: number } {
  const first = lines[0] ?? "";
  const m = first.match(/^=[ \t]+(\S.*?)[ \t]*$/);
  if (!m) return { doctitle: null, attributes: null, bodyStart: 0 };
  const attributes: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    const a = line.match(ATTR_RE);
    if (!a) break; // author/revision or anything else ends the header
    const negated = a[1] === "!" || a[3] === "!";
    attributes[a[2]] = negated ? NEGATED : (a[4] ?? "");
  }
  return { doctitle: m[1], attributes, bodyStart: i };
}

/** Outbound document links: `xref:target[]` and `<<target>>` whose file
 *  component (fragment stripped first) ends in `.adoc`/`.asciidoc`. */
export function extractXrefs(text: string): string[] {
  const out: string[] = [];
  const take = (raw: string) => {
    const file = raw.split("#")[0].trim();
    if (file && ADOC_EXT_RE.test(file)) out.push(file);
  };
  for (const m of text.matchAll(/xref:([^\[\s]+)\[/g)) take(m[1]);
  for (const m of text.matchAll(/<<([^>,\s]+)(?:,[^>]*)?>>/g)) take(m[1]);
  return out;
}

/** Split a section's body into paragraph groups whose boundaries (blank lines)
 *  all sit OUTSIDE delimited blocks. A section with no safe boundary yields a
 *  single group — which the caller emits as one oversized chunk. */
function safeGroups(bodyLines: string[], lineNos: number[]): Array<{ lines: string[]; nos: number[] }> {
  const groups: Array<{ lines: string[]; nos: number[] }> = [];
  let cur: { lines: string[]; nos: number[] } = { lines: [], nos: [] };
  let open: string | null = null;
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const d = delimiterOf(line);
    if (open) {
      if (d === open) open = null;
    } else if (d) {
      open = d;
    } else if (line.trim() === "") {
      if (cur.lines.length) groups.push(cur);
      cur = { lines: [], nos: [] };
      continue; // blank separators are dropped (markdown splitter parity)
    }
    cur.lines.push(line);
    cur.nos.push(lineNos[i]);
  }
  if (cur.lines.length) groups.push(cur);
  return groups;
}

export function chunkAsciiDoc(input: AdocChunkInput): AdocParseResult {
  const docType: DocType = input.docType ?? "doc";
  const norm = input.text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = norm.split("\n");
  const fileTitle = (input.path.split("/").pop() ?? input.path).replace(ADOC_EXT_RE, "");
  const { doctitle, attributes, bodyStart } = parseHeader(lines);
  const rootTitle = doctitle ?? fileTitle;

  const raw: Section[] = [];
  // A doctitle is a real level-0 document heading, so it roots the breadcrumb.
  // Without a header the preamble heading is the file name and roots nothing
  // (markdown chunker parity).
  const stack: Array<{ level: number; title: string; chunkOrdinal: number }> = [];
  if (doctitle) stack.push({ level: 0, title: doctitle, chunkOrdinal: -1 });
  let cur: Section | null = null;
  let open: string | null = null;
  let ordinal = 0;

  const flush = () => {
    if (cur && bodyOf(cur).trim()) raw.push(cur);
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const d = delimiterOf(line);
    if (open) {
      if (d === open) open = null;
    } else if (d) {
      open = d;
    } else {
      const tm = line.match(TITLE_RE);
      if (tm) {
        flush();
        const level = tm[1].length;
        const title = tm[2];
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const parentOrdinal = stack.length ? stack[stack.length - 1].chunkOrdinal : -1;
        stack.push({ level, title, chunkOrdinal: ordinal });
        cur = {
          headingPath: stack.map((s) => s.title).join(" > "),
          heading: title,
          level,
          parentChunkId: parentOrdinal >= 0 ? String(parentOrdinal) : null,
          headingLine: lineNo,
          bodyLines: [],
          lineNos: [],
        };
        ordinal++;
        continue;
      }
    }
    if (!cur) {
      cur = { headingPath: rootTitle, heading: rootTitle, level: 0, parentChunkId: null, headingLine: lineNo, bodyLines: [], lineNos: [] };
      if (doctitle) stack[0].chunkOrdinal = ordinal; // the doctitle's own chunk
      ordinal++;
    }
    cur.bodyLines.push(line);
    cur.lineNos.push(lineNo);
  }
  flush();

  // tiny-merge — same threshold constant as the markdown chunker (parity)
  const merged: Section[] = [];
  for (const c of raw) {
    if (bodyOf(c).trim().length < MIN_CHUNK_CHARS && merged.length) {
      const prev = merged[merged.length - 1];
      prev.bodyLines.push("", c.heading, ...c.bodyLines);
      prev.lineNos.push(c.headingLine, c.headingLine, ...c.lineNos);
    } else merged.push(c);
  }

  // oversize-split — block-safe: split points are blank lines outside blocks
  const sized: Section[] = [];
  for (const c of merged) {
    if (bodyOf(c).length <= MAX_CHUNK_CHARS) {
      sized.push(c);
      continue;
    }
    const groups = safeGroups(c.bodyLines, c.lineNos);
    let buf: { lines: string[]; nos: number[] } = { lines: [], nos: [] };
    const emit = () => {
      if (buf.lines.length) sized.push({ ...c, bodyLines: buf.lines, lineNos: buf.nos });
      buf = { lines: [], nos: [] };
    };
    for (const g of groups) {
      const glen = g.lines.reduce((n, l) => n + l.length + 1, 0);
      const blen = buf.lines.reduce((n, l) => n + l.length + 1, 0);
      if (blen && blen + glen > MAX_CHUNK_CHARS) emit();
      buf.lines.push(...g.lines, "");
      buf.nos.push(...g.nos, g.nos[g.nos.length - 1]);
    }
    emit();
  }

  const fileSha = sha(input.path);
  const chunks: Chunk[] = sized.map((c, i) => {
    const body = bodyOf(c);
    const anchors = realAnchors(c);
    return {
      root: input.root,
      path: input.path,
      chunkId: `${fileSha.slice(0, 8)}:${i}`,
      headingPath: c.headingPath,
      heading: c.heading,
      level: c.level,
      parentChunkId: c.parentChunkId ? `${fileSha.slice(0, 8)}:${c.parentChunkId}` : null,
      docType,
      body: body.trimEnd(),
      bodyHash: sha(body.trim()),
      startLine: anchors.startLine,
      endLine: anchors.endLine,
    };
  });

  const frontmatter: Record<string, FmValue> | null = attributes ? { ...attributes, ...(doctitle ? { title: doctitle } : {}) } : null;

  return { chunks, attributes, doctitle, frontmatter, wikilinks: [], mdLinks: extractXrefs(norm), parseFailed: false };
}

/** Line anchors bound the section's real content — blank padding at either end
 *  is excluded so the range matches what the chunk body actually covers. */
function realAnchors(c: Section): { startLine: number; endLine: number } {
  let first = 0;
  let last = c.bodyLines.length - 1;
  while (first < c.bodyLines.length && c.bodyLines[first].trim() === "") first++;
  while (last >= 0 && c.bodyLines[last].trim() === "") last--;
  if (first > last) return { startLine: c.headingLine, endLine: c.headingLine };
  return { startLine: c.lineNos[first], endLine: c.lineNos[last] };
}
