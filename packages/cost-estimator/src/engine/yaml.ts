/**
 * Minimal zero-dependency YAML-subset parser.
 *
 * Supports exactly what the estimator input contract needs:
 *  - nested mappings by indentation
 *  - block sequences (`- item`, `- key: value` inline-start)
 *  - scalars: string, number, boolean, null
 *  - flow sequences on one line: `[a, b, c]`
 *  - quoted strings ('single' and "double")
 *  - `#` comments and blank lines
 *
 * Deliberately NOT supported: anchors, aliases, multi-line block scalars,
 * flow mappings, multiple documents. Throws with a line number on anything else.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  no: number;
}

/** Parse a YAML-subset document into a plain JS value. */
export function parseYaml(source: string): YamlValue {
  const lines = tokenize(source);
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
}

/** Parse a JSON or YAML file body, dispatching on the file extension. */
export function parseDataFile(path: string, body: string): YamlValue {
  if (/\.json$/i.test(path)) return JSON.parse(body) as YamlValue;
  return parseYaml(body);
}

function tokenize(source: string): Line[] {
  const out: Line[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    if (raw.includes('\t')) throw new Error(`YAML line ${i + 1}: tabs are not allowed for indentation`);
    const stripped = stripComment(raw);
    if (stripped.trim() === '') return;
    out.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trim(), no: i + 1 });
  });
  return out;
}

/** Remove a trailing `#` comment, honouring quotes. */
function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** Parse consecutive lines at `indent` starting at `i`. Returns [value, nextIndex]. */
function parseBlock(lines: Line[], i: number, indent: number): [YamlValue, number] {
  if (i >= lines.length) return [null, i];
  return lines[i].text.startsWith('- ') || lines[i].text === '-'
    ? parseSequence(lines, i, indent)
    : parseMapping(lines, i, indent);
}

function parseSequence(lines: Line[], i: number, indent: number): [YamlValue[], number] {
  const items: YamlValue[] = [];
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
    const line = lines[i];
    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    i++;
    if (rest === '') {
      // Value lives on following, deeper lines.
      if (i < lines.length && lines[i].indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i].indent);
        items.push(value);
        i = next;
      } else items.push(null);
      continue;
    }
    const colon = splitKey(rest);
    if (colon) {
      // `- key: value` opens an inline mapping whose siblings are indented under the dash.
      const childIndent = indent + 2;
      const synthetic: Line[] = [{ indent: childIndent, text: rest, no: line.no }];
      while (i < lines.length && lines[i].indent > indent) {
        synthetic.push({ ...lines[i], indent: lines[i].indent });
        i++;
      }
      const normalized = normalizeIndent(synthetic, childIndent);
      const [value] = parseMapping(normalized, 0, normalized[0].indent);
      items.push(value);
    } else {
      items.push(parseScalar(rest, line.no));
    }
  }
  return [items, i];
}

/** Re-base a synthetic block so the first line sits exactly at `target` indent. */
function normalizeIndent(lines: Line[], target: number): Line[] {
  const base = Math.min(...lines.map((l) => l.indent));
  const delta = target - base;
  return lines.map((l) => ({ ...l, indent: l.indent + delta }));
}

function parseMapping(lines: Line[], i: number, indent: number): [Record<string, YamlValue>, number] {
  const map: Record<string, YamlValue> = {};
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    if (line.text.startsWith('- ')) break;
    const parts = splitKey(line.text);
    if (!parts) throw new Error(`YAML line ${line.no}: expected "key: value", got "${line.text}"`);
    const [key, rest] = parts;
    i++;
    if (rest !== '') {
      map[key] = parseScalar(rest, line.no);
      continue;
    }
    if (i < lines.length && lines[i].indent > indent) {
      const [value, next] = parseBlock(lines, i, lines[i].indent);
      map[key] = value;
      i = next;
    } else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
      const [value, next] = parseSequence(lines, i, indent);
      map[key] = value;
      i = next;
    } else {
      map[key] = null;
    }
  }
  return [map, i];
}

/** Split `key: rest` outside quotes. Returns null when the line has no top-level colon. */
function splitKey(text: string): [string, string] | null {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ':' && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return [unquote(text.slice(0, i).trim()), text.slice(i + 1).trim()];
    }
  }
  return null;
}

function parseScalar(text: string, lineNo: number): YamlValue {
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new Error(`YAML line ${lineNo}: unterminated flow sequence`);
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlow(inner).map((part) => parseScalar(part.trim(), lineNo));
  }
  if (text.startsWith('{')) throw new Error(`YAML line ${lineNo}: flow mappings are not supported`);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return unquote(text);
  }
  const lower = text.toLowerCase();
  if (lower === 'true' || lower === 'yes') return true;
  if (lower === 'false' || lower === 'no') return false;
  if (lower === 'null' || lower === '~' || lower === '') return null;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (/^-?\d+(\.\d+)?%$/.test(text)) return Number(text.slice(0, -1)) / 100;
  return text;
}

/** Split a flow sequence body on commas that sit outside quotes and brackets. */
function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out;
}

function unquote(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return text;
}
