/**
 * Google Sheets tools (`gsheets_*`, design D11; spec google-sheets-tools). Reads need Sheets at level `read`;
 * `gsheets_create` / `_write` / `_append` need `write` and are confirmed first (account, spreadsheet, tab, range,
 * cell count, first rows). Values are written LITERALLY (`valueInputOption=RAW`, scenario-gate C19) unless the call
 * passes `evaluate_formulas: true` (`USER_ENTERED`); then the dialog says so and lists the formula cells.
 * A read returns at most 10 000 cells and a `nextRange` to continue; one row wider than the cap is still returned
 * whole (C17). A write's `range` is only its top-left anchor — the extent comes from the values (C18).
 * See change: add-google-connect.
 */

import { optBool, type Params, reqStr } from "../params.js";
import { clip, listed, rowLines } from "../preview.js";
import type { Call, ProductTools, ToolOutput } from "../runtime.js";
import { GoogleToolError, invalidParams } from "../tool-error.js";

/** Cells per read, and per write (a bigger write could not be reviewed in a dialog anyway). */
export const MAX_CELLS = 10_000;
const MAX_COLUMN = 18_278; // ZZZ
const enc = encodeURIComponent;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const META_FIELDS = "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))";

// ───────────── A1 notation ─────────────

/** 1-based inclusive bounds; a bound is absent for an open range such as `A:Z` or `5:9`. */
interface Cells {
  c1?: number;
  r1?: number;
  c2?: number;
  r2?: number;
}
type Bounds = Required<Cells>;
interface Ref {
  sheet?: string;
  cells?: Cells;
}

const colNum = (s: string): number => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function colName(n: number): string {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
const a1 = (c: number, r: number): string => `${colName(c)}${r}`;

/** One side of `A1:B2`: a column, a row or both. */
function side(s: string): { c?: number; r?: number } | undefined {
  const m = /^\$?([A-Za-z]{1,3})?\$?([1-9]\d{0,6})?$/.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
  const c = m[1] === undefined ? undefined : colNum(m[1]);
  if (c !== undefined && c > MAX_COLUMN) return undefined;
  return { ...(c !== undefined ? { c } : {}), ...(m[2] !== undefined ? { r: Number(m[2]) } : {}) };
}

/** `A1`, `A1:B2`, `A:Z`, `5:9`, `A5:Z`. A lone `A` or `12` is not a cell (it is far likelier a tab name). */
function parseCells(s: string): Cells | undefined {
  const parts = s.split(":");
  if (parts.length > 2) return undefined;
  const a = side(parts[0] ?? "");
  if (!a) return undefined;
  if (parts.length === 1) return a.c !== undefined && a.r !== undefined ? { c1: a.c, r1: a.r, c2: a.c, r2: a.r } : undefined;
  const b = side(parts[1] ?? "");
  if (!b) return undefined;
  return { c1: a.c, r1: a.r, c2: b.c, r2: b.r };
}

/** `Data!A1:B2`, `'It''s'!A1`, `A1:B2` (first tab), `Data` (a whole tab). `undefined` = not A1 (named range, garbage). */
function parseRef(range: string): Ref | undefined {
  const quoted = /^'((?:[^']|'')*)'!(.*)$/.exec(range);
  const plain = quoted ? null : /^([^!']+)!(.*)$/.exec(range);
  const m = quoted ?? plain;
  if (m) {
    const sheet = quoted ? (m[1] as string).replace(/''/g, "'") : (m[1] as string);
    if (m[2] === "") return { sheet };
    const cells = parseCells(m[2] as string);
    return cells ? { sheet, cells } : undefined;
  }
  const cells = parseCells(range);
  if (cells) return { cells };
  const q = /^'((?:[^']|'')+)'$/.exec(range);
  if (q) return { sheet: (q[1] as string).replace(/''/g, "'") };
  return range.includes("!") || range.includes("'") ? undefined : { sheet: range };
}

/** A tab name in a range: bare when that is unambiguous, else `'…'` with `'` doubled. */
const tabRef = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !parseCells(name) ? name : `'${name.replace(/'/g, "''")}'`);

const closed = (c: Cells): c is Bounds => c.c1 !== undefined && c.r1 !== undefined && c.c2 !== undefined && c.r2 !== undefined;

// ───────────── spreadsheet metadata ─────────────

interface Meta {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  properties?: { title?: string };
  sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
}

const meta = (call: Call, id: string): Promise<Meta> => call.api.request<Meta>("GET", `/spreadsheets/${enc(id)}`, { query: { fields: META_FIELDS } });

/** The tab a ref names (first tab when it names none) — `undefined` when the spreadsheet has no such tab. */
function findTab(m: Meta, name: string | undefined) {
  const tabs = (m.sheets ?? []).map((s) => s.properties).filter((p): p is NonNullable<typeof p> => !!p);
  return name === undefined ? tabs[0] : tabs.find((t) => t.title === name);
}

// ───────────── arguments ─────────────

const spreadsheetId = (p: Params) => {
  const id = reqStr(p, "spreadsheetId", 200);
  if (!ID.test(id)) throw invalidParams("`spreadsheetId` is not a valid spreadsheet id (the long id in the spreadsheet URL)");
  return id;
};

type CellValue = string | number | boolean | null;
type Grid = CellValue[][];

function checkCell(x: unknown, name: string): void {
  if (x !== null && typeof x !== "string" && typeof x !== "number" && typeof x !== "boolean") throw invalidParams(`\`${name}\` cells must be strings, numbers, booleans or null`);
  if (typeof x === "number" && !Number.isFinite(x)) throw invalidParams(`\`${name}\` has a non-finite number`);
}

/** A non-empty 2-D array of literals (string / number / boolean / null = empty cell), ≤ 10 000 cells. */
function gridOf(p: Params, name: string): Grid {
  const v = p[name];
  if (!Array.isArray(v) || v.length === 0) throw invalidParams(`\`${name}\` must be a non-empty array of rows (each row an array of cell values)`);
  let cells = 0;
  for (const row of v) {
    if (!Array.isArray(row)) throw invalidParams(`\`${name}\` must be an array of rows; each row must be an array`);
    for (const x of row) checkCell(x, name);
    cells += row.length;
    if (cells > MAX_CELLS) throw invalidParams(`\`${name}\` has more than ${MAX_CELLS} cells; write in smaller pieces`);
  }
  if (cells === 0) throw invalidParams(`\`${name}\` has no cells`);
  return v as Grid;
}

const widthOf = (g: Grid): number => g.reduce((w, r) => Math.max(w, r.length), 0);
const cellCount = (g: Grid): number => g.reduce((n, r) => n + r.length, 0);

/** Text a formula-evaluating write would treat as a formula: `=…`, or `+`/`-` followed by a function/reference. */
const FORMULA = /^(=|[+-][A-Za-z($'"@])/;
function formulaCells(g: Grid, c1: number, r1: number): string[] {
  const out: string[] = [];
  g.forEach((row, i) => row.forEach((x, j) => typeof x === "string" && FORMULA.test(x) && out.push(a1(c1 + j, r1 + i))));
  return out;
}

const inputOption = (evaluate: boolean | undefined) => (evaluate ? "USER_ENTERED" : "RAW");

function evaluationLines(evaluate: boolean | undefined, formulas: string[]): string[] {
  if (!evaluate) return ["Values: written literally (formulas stay text)"];
  return [
    "Values: formulas WILL be evaluated (USER_ENTERED - numbers, dates and formulas are interpreted)",
    formulas.length ? `Formula cells (${formulas.length}): ${listed(formulas)}` : "Formula cells: none (0)",
  ];
}

const rowText = (row: CellValue[]): string => row.map((x) => (x === null ? "" : String(x))).join(" | ");

const ID_PROP = { type: "string", description: "Spreadsheet id (the long id in the spreadsheet URL)." };
const VALUES_PROP = { type: "array", items: { type: "array", items: { type: ["string", "number", "boolean", "null"] } }, minItems: 1, description: `Rows of cell values (at most ${MAX_CELLS} cells).` };
const EVAL_PROP = { type: "boolean", description: "Evaluate text starting with `=` as formulas (and interpret numbers/dates). Default false: values are written literally." };

interface Target {
  title: string;
  tab: string;
}

/** Pre-confirm lookup shared by write and append: spreadsheet title + the tab the range names. */
async function target(call: Call, id: string, ref: Ref): Promise<Target> {
  const m = await meta(call, id);
  const tab = findTab(m, ref.sheet);
  if (!tab?.title) {
    const names = (m.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
    throw new GoogleToolError("sheets_error", `the spreadsheet has no tab ${ref.sheet === undefined ? "" : `"${clip(ref.sheet, 100)}" `}(tabs: ${listed(names, 20) || "none"})`);
  }
  return { title: m.properties?.title ?? id, tab: tab.title };
}

const targetLines = (t: Target, id: string): string[] => [`Spreadsheet: ${clip(t.title, 200)} (${clip(id, 60)})`, `Tab: ${clip(t.tab, 120)}`];

// ───────────── read paging ─────────────

/** Rows of `b` per page: as many full rows as fit in the cap, never fewer than one (scenario-gate C17). */
const rowsPerPage = (b: Bounds): number => Math.max(1, Math.floor(MAX_CELLS / (b.c2 - b.c1 + 1)));

/** The range of rows `from`…`to` of `b`, on `tab` (a ready prefix such as `Data!`, or ``). */
const rowsRange = (prefix: string, b: Bounds, from: number, to: number): string => `${prefix}${a1(b.c1, from)}:${a1(b.c2, to)}`;

interface ReadResult {
  range?: string;
  values?: unknown[][];
}

/** The bounds a read covers: as written when closed, else completed from the tab's grid; `undefined` = not A1 (a named range). */
async function boundsOf(call: Call, id: string, ref: Ref): Promise<Bounds | undefined> {
  if (ref.cells && closed(ref.cells)) return ref.cells;
  const g = findTab(await meta(call, id), ref.sheet)?.gridProperties;
  if (!g?.rowCount || !g.columnCount) return undefined;
  const c = ref.cells ?? {};
  return { c1: c.c1 ?? 1, r1: c.r1 ?? 1, c2: c.c2 ?? g.columnCount, r2: c.r2 ?? g.rowCount };
}

/** What to request for `b`: the range as written when it fits the cap, else the first page of whole rows + the range after it. */
function firstPage(ref: Ref, b: Bounds, range: string): { sent: string; next?: string } {
  const prefix = ref.sheet === undefined ? "" : `${tabRef(ref.sheet)}!`;
  const page = rowsPerPage(b);
  if (b.r2 - b.r1 + 1 <= page) return { sent: range };
  return { sent: rowsRange(prefix, b, b.r1, b.r1 + page - 1), next: rowsRange(prefix, b, b.r1 + page, b.r2) };
}

function readReply(r: ReadResult, sent: string, out: { values: unknown[][]; truncated?: true; next?: string }) {
  return { range: r.range ?? sent, values: out.values, cells: cellCount(out.values as Grid), ...(out.truncated ? { truncated: true, ...(out.next ? { nextRange: out.next } : {}) } : {}) };
}

/** A read that was not A1 (named range): Google resolved it; cut whole rows here and continue from the resolved range when it is A1. */
function cutResolved(r: ReadResult): { values: unknown[][]; truncated?: true; next?: string } {
  const values = r.values ?? [];
  if (cellCount(values as Grid) <= MAX_CELLS) return { values };
  const keep = Math.max(1, Math.floor(MAX_CELLS / Math.max(1, widthOf(values as Grid))));
  const got = r.range ? parseRef(r.range) : undefined;
  const more = got?.cells && closed(got.cells) && got.cells.r1 + keep <= got.cells.r2;
  return { values: values.slice(0, keep), truncated: true, ...(more ? { next: rowsRange(got.sheet === undefined ? "" : `${tabRef(got.sheet)}!`, got.cells as Bounds, (got.cells as Bounds).r1 + keep, (got.cells as Bounds).r2) } : {}) };
}

export const gsheets: ProductTools = {
  product: "sheets",
  create(rt) {
    return [
      rt.define({
        name: "gsheets_get",
        label: "Spreadsheet info",
        description: "Get a spreadsheet's title and tabs (id, name, rows, columns). Requires Sheets level read.",
        properties: { spreadsheetId: ID_PROP },
        required: ["spreadsheetId"],
        level: "read",
        parse: (p) => ({ id: spreadsheetId(p) }),
        async run(a, call): Promise<ToolOutput> {
          const m = await meta(call, a.id);
          return {
            json: {
              id: m.spreadsheetId ?? a.id,
              title: m.properties?.title,
              url: m.spreadsheetUrl,
              tabs: (m.sheets ?? []).map((s) => ({ id: s.properties?.sheetId, title: s.properties?.title, rows: s.properties?.gridProperties?.rowCount, columns: s.properties?.gridProperties?.columnCount })),
            },
          };
        },
      }),

      rt.define({
        name: "gsheets_read",
        label: "Read range",
        description: `Read the values of an A1 range (\`Data!A1:C20\`, \`A:Z\`, a whole tab name). At most ${MAX_CELLS} cells per call (whole rows); a longer range returns \`truncated\` and \`nextRange\` to read next. Requires Sheets level read.`,
        properties: { spreadsheetId: ID_PROP, range: { type: "string", description: "A1 range, optionally with a tab name: `Data!A1:C20`, `'My tab'!A:Z`." } },
        required: ["spreadsheetId", "range"],
        level: "read",
        parse: (p) => ({ id: spreadsheetId(p), range: reqStr(p, "range", 500) }),
        async run(a, call): Promise<ToolOutput> {
          const ref = parseRef(a.range);
          const b = ref ? await boundsOf(call, a.id, ref) : undefined;
          const page = ref && b ? firstPage(ref, b, a.range) : undefined;
          const sent = page?.sent ?? a.range;
          const r = await call.api.request<ReadResult>("GET", `/spreadsheets/${enc(a.id)}/values/${enc(sent)}`, {
            query: { majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" },
          });
          return { json: readReply(r, sent, page ? { values: r.values ?? [], ...(page.next ? { truncated: true as const, next: page.next } : {}) } : cutResolved(r)) };
        },
      }),

      rt.define<{ title: string; tabs: string[]; values?: Grid; evaluate?: boolean }>({
        name: "gsheets_create",
        label: "create spreadsheet",
        description:
          "Create a new spreadsheet (requires Sheets level write; the user confirms first), optionally with named tabs and initial values written at A1 of the first tab. Values are literal unless evaluate_formulas is true. Returns the id and URL.",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          tabs: { type: "array", items: { type: "string", minLength: 1, maxLength: 100 }, maxItems: 50, description: "Tab names (default: one default tab)." },
          values: VALUES_PROP,
          evaluate_formulas: EVAL_PROP,
        },
        required: ["title"],
        level: "write",
        write: true,
        parse(p) {
          const tabs = p.tabs === undefined || p.tabs === null ? [] : p.tabs;
          if (!Array.isArray(tabs) || tabs.some((t) => typeof t !== "string" || !t.trim() || t.length > 100) || tabs.length > 50 || new Set(tabs).size !== tabs.length) {
            throw invalidParams("`tabs` must be a list of up to 50 distinct, non-empty tab names");
          }
          return { title: reqStr(p, "title", 200), tabs: tabs as string[], ...(p.values === undefined || p.values === null ? {} : { values: gridOf(p, "values") }), evaluate: optBool(p, "evaluate_formulas") };
        },
        summary: (a) => [
          `New spreadsheet: ${clip(a.title, 200)}`,
          a.tabs.length ? `Tabs (${a.tabs.length}): ${listed(a.tabs)}` : "Tabs: default",
          ...(a.values
            ? [`Initial values: ${cellCount(a.values)} cells (${a.values.length} rows) at A1 of ${a.tabs[0] ? clip(a.tabs[0], 120) : "the first tab"}`, ...evaluationLines(a.evaluate, formulaCells(a.values, 1, 1)), ...rowLines(a.values.map(rowText))]
            : []),
        ],
        async run(a, call): Promise<ToolOutput> {
          const created = await call.api.request<Meta>("POST", "/spreadsheets", {
            body: { properties: { title: a.title }, ...(a.tabs.length ? { sheets: a.tabs.map((title) => ({ properties: { title } })) } : {}) },
          });
          const id = created.spreadsheetId ?? "";
          const first = a.tabs[0] ?? created.sheets?.[0]?.properties?.title;
          const result = { created: true, spreadsheetId: id, url: created.spreadsheetUrl, title: created.properties?.title ?? a.title, tabs: (created.sheets ?? []).map((s) => s.properties?.title) };
          if (!a.values) return { json: result };
          try {
            const range = `${tabRef(first ?? "Sheet1")}!${a1(1, 1)}:${a1(widthOf(a.values), a.values.length)}`;
            await call.api.request("PUT", `/spreadsheets/${enc(id)}/values/${enc(range)}`, {
              query: { valueInputOption: inputOption(a.evaluate) },
              body: { range, majorDimension: "ROWS", values: a.values },
            });
            return { json: { ...result, valuesWritten: true } };
          } catch (e) {
            // The spreadsheet exists now — say so instead of hiding the id behind the error.
            return { json: { ...result, valuesWritten: false, valuesError: (e as Error).message.slice(0, 300) } };
          }
        },
      }),

      rt.define<{ id: string; ref: Ref; values: Grid; evaluate?: boolean }, Target & { range: string; formulas: string[] }>({
        name: "gsheets_write",
        label: "write range",
        description:
          "Overwrite cells with values (requires Sheets level write; the user confirms first). `range` is the TOP-LEFT anchor (e.g. `Data!B2`); the extent comes from the values. Values are written literally - text such as `=1+1` stays text - unless evaluate_formulas is true.",
        properties: { spreadsheetId: ID_PROP, range: { type: "string", description: "Anchor cell or range with tab: `Data!B2` (only its top-left cell is used)." }, values: VALUES_PROP, evaluate_formulas: EVAL_PROP },
        required: ["spreadsheetId", "range", "values"],
        level: "write",
        write: true,
        parse(p) {
          const range = reqStr(p, "range", 500);
          const ref = parseRef(range);
          if (!ref) throw invalidParams("`range` must be an A1 range such as Data!B2 or Data!B2:E4");
          const values = gridOf(p, "values");
          if ((ref.cells?.c1 ?? 1) + widthOf(values) - 1 > MAX_COLUMN) throw invalidParams("`values` is too wide for the range's start column");
          return { id: spreadsheetId(p), ref, values, evaluate: optBool(p, "evaluate_formulas") };
        },
        async prepare(a, call) {
          const t = await target(call, a.id, a.ref);
          const c1 = a.ref.cells?.c1 ?? 1;
          const r1 = a.ref.cells?.r1 ?? 1;
          return { ...t, range: `${tabRef(t.tab)}!${a1(c1, r1)}:${a1(c1 + widthOf(a.values) - 1, r1 + a.values.length - 1)}`, formulas: formulaCells(a.values, c1, r1) };
        },
        summary: (a, s) => [
          ...targetLines(s, a.id),
          `Range: ${clip(s.range, 200)}`,
          `Cells: ${cellCount(a.values)} (${a.values.length} rows x ${widthOf(a.values)} columns) - existing contents are overwritten`,
          ...evaluationLines(a.evaluate, s.formulas),
          ...rowLines(a.values.map(rowText)),
        ],
        async run(a, call, s): Promise<ToolOutput> {
          const r = await call.api.request<{ updatedRange?: string; updatedRows?: number; updatedColumns?: number; updatedCells?: number }>("PUT", `/spreadsheets/${enc(a.id)}/values/${enc(s.range)}`, {
            query: { valueInputOption: inputOption(a.evaluate) },
            body: { range: s.range, majorDimension: "ROWS", values: a.values },
          });
          return { json: { updated: true, spreadsheetId: a.id, updatedRange: r.updatedRange ?? s.range, updatedRows: r.updatedRows, updatedColumns: r.updatedColumns, updatedCells: r.updatedCells } };
        },
      }),

      rt.define<{ id: string; range: string; ref: Ref; values: Grid; evaluate?: boolean }, Target & { formulas: string[] }>({
        name: "gsheets_append",
        label: "append rows",
        description:
          "Append rows after the last row of the table found in `range` (a tab name, or a range such as `Data!A1:C5` inside the table) (requires Sheets level write; the user confirms first). Values are literal unless evaluate_formulas is true.",
        properties: { spreadsheetId: ID_PROP, range: { type: "string", description: "Tab name or a range inside the table: `Data` or `Data!A1:C5`." }, values: VALUES_PROP, evaluate_formulas: EVAL_PROP },
        required: ["spreadsheetId", "range", "values"],
        level: "write",
        write: true,
        parse(p) {
          const range = reqStr(p, "range", 500);
          const ref = parseRef(range);
          if (!ref) throw invalidParams("`range` must be a tab name or an A1 range such as Data!A1:C5");
          return { id: spreadsheetId(p), range, ref, values: gridOf(p, "values"), evaluate: optBool(p, "evaluate_formulas") };
        },
        async prepare(a, call) {
          const t = await target(call, a.id, a.ref);
          // The new rows' position is only known once Google appends them; formula cells are listed as offsets from the first new row.
          return { ...t, formulas: formulaCells(a.values, a.ref.cells?.c1 ?? 1, 1) };
        },
        summary: (a, s) => [
          ...targetLines(s, a.id),
          `Table range: ${clip(a.range, 200)}`,
          `Rows appended: ${a.values.length} (${cellCount(a.values)} cells) after the table's last row`,
          ...evaluationLines(a.evaluate, s.formulas).map((l) => (l.startsWith("Formula cells") ? `${l} (row 1 = the first new row)` : l)),
          ...rowLines(a.values.map(rowText)),
        ],
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<{ updates?: { updatedRange?: string; updatedRows?: number; updatedColumns?: number; updatedCells?: number } }>("POST", `/spreadsheets/${enc(a.id)}/values/${enc(a.range)}:append`, {
            query: { valueInputOption: inputOption(a.evaluate), insertDataOption: "INSERT_ROWS" },
            body: { majorDimension: "ROWS", values: a.values },
          });
          const u = r.updates ?? {};
          return { json: { appended: true, spreadsheetId: a.id, updatedRange: u.updatedRange, updatedRows: u.updatedRows, updatedCells: u.updatedCells } };
        },
      }),
    ];
  },
};
