/**
 * L1 Sheets tools (test-plan #C84–#C95; tasks 12.83–12.94) against the REAL lease handler and a fake Google
 * Sheets (tabs, a cell store that honours `valueInputOption`). See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { createFakeGoogle, type FakeGoogle, type FakeReply, type FakeRequest, googleError, jsonOf, makeToolHost, NO_UI, uiCtx } from "./fake-google.js";

const ME = "a@x.com";
const WORK = { sub: "s1", email: ME, alias: "work", products: { sheets: "write" } } as const;
const ID = "sheet1abcdef";
const SHEET = `/spreadsheets/${ID}`;

const col = (n: number): string => {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
const colN = (s: string): number => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const unq = (s: string) => s.replace(/^'|'(?=!)/g, "").replace(/''/g, "'");

interface Tab {
  title: string;
  rows: number;
  cols: number;
}
interface Stored {
  value: unknown;
  formula: boolean;
}

/** A tiny stateful spreadsheet behind the fake: metadata, values PUT/append (RAW vs USER_ENTERED), create. */
function spreadsheet(google: FakeGoogle, tabs: Tab[] = [{ title: "Data", rows: 1000, cols: 26 }, { title: "It's", rows: 50, cols: 5 }]) {
  const grid = new Map<string, Stored>();
  const put = (tab: string, c: number, r: number, v: unknown, input: string | undefined) => {
    grid.set(`${tab}!${col(c)}${r}`, { value: v, formula: input === "USER_ENTERED" && typeof v === "string" && v.startsWith("=") });
  };
  const decoded = (req: FakeRequest) => decodeURIComponent(req.path.split("/values/")[1] ?? "");
  google
    .on("GET", SHEET, { json: { spreadsheetId: ID, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}`, properties: { title: "Budget" }, sheets: tabs.map((t, i) => ({ properties: { sheetId: i, title: t.title, index: i, gridProperties: { rowCount: t.rows, columnCount: t.cols } } })) } })
    .on("PUT", /^\/spreadsheets\/[^/]+\/values\/[^/]+$/, (req) => {
      const range = decoded(req);
      const m = /^(.+)!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
      if (!m) return googleError(400, "badRequest", undefined, `Unable to parse range: ${range}`);
      const values = (req.body as { values: unknown[][] }).values;
      values.forEach((row, i) => row.forEach((v, j) => put(unq(m[1] as string), colN(m[2] as string) + j, Number(m[3]) + i, v, req.query.valueInputOption)));
      return { json: { updatedRange: range, updatedRows: values.length, updatedColumns: Math.max(...values.map((r) => r.length)), updatedCells: values.flat().length } };
    })
    .on("POST", /^\/spreadsheets\/[^/]+\/values\/.+:append$/, (req) => {
      const tab = unq(decoded(req).replace(/:append$/, "").split("!")[0] as string);
      const last = Math.max(0, ...[...grid.keys()].filter((k) => k.startsWith(`${tab}!`)).map((k) => Number(/\d+$/.exec(k)?.[0])));
      const values = (req.body as { values: unknown[][] }).values;
      values.forEach((row, i) => row.forEach((v, j) => put(tab, 1 + j, last + 1 + i, v, req.query.valueInputOption)));
      return { json: { updates: { updatedRange: `${tab}!A${last + 1}:${col(Math.max(...values.map((r) => r.length)))}${last + values.length}`, updatedRows: values.length, updatedCells: values.flat().length } } };
    })
    .on("POST", "/spreadsheets", (req) => {
      const sheets = ((req.body as { sheets?: Array<{ properties: { title: string } }> }).sheets ?? [{ properties: { title: "Sheet1" } }]).map((s) => ({ properties: s.properties }));
      return { json: { spreadsheetId: "new123", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new123", properties: { title: (req.body as { properties: { title: string } }).properties.title }, sheets } };
    });
  return { grid };
}

function host(over: { account?: Record<string, unknown>; tabs?: Tab[] } = {}) {
  const google = createFakeGoogle();
  const sheet = spreadsheet(google, over.tabs);
  const h = makeToolHost({ accounts: [{ ...WORK, ...over.account } as never], google });
  return { ...h, ...sheet };
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
const confirmText = (c: ReturnType<typeof uiCtx>) => (c.confirm.mock.calls[0] as [string, string]).slice(0, 2).join("\n");

/** Answers a values GET with one cell ("r<row>c<col>") per cell of a bounded range. */
const generate = (req: FakeRequest): FakeReply => {
  const range = decodeURIComponent(req.path.split("/values/")[1] ?? "");
  const m = /^(?:.+!)?([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range) as RegExpExecArray;
  const [c1, r1, c2, r2] = [colN(m[1] as string), Number(m[2]), colN(m[3] as string), Number(m[4])];
  const values = Array.from({ length: r2 - r1 + 1 }, (_, i) => Array.from({ length: c2 - c1 + 1 }, (_, j) => `r${r1 + i}c${c1 + j}`));
  return { json: { range: `Data!${range.replace(/^.+!/, "")}`, majorDimension: "ROWS", values } };
};
const sentRanges = (h: { google: FakeGoogle }) => h.google.to("GET", /\/values\//).map((r) => decodeURIComponent(r.path.split("/values/")[1] ?? ""));
type Read = { range: string; values: unknown[][]; cells: number; truncated?: boolean; nextRange?: string };
const read = async (h: ReturnType<typeof host>, range: string) => jsonOf<Read>(await h.run("gsheets_read", { account: "work", spreadsheetId: ID, range }));

describe("Sheets read tools", () => {
  it("gsheets_get returns title, url and tabs with grid sizes", async () => {
    const h = host();
    const r = jsonOf<{ title: string; tabs: Array<{ title: string; rows: number; columns: number }> }>(await h.run("gsheets_get", { account: "work", spreadsheetId: ID }));
    expect(r.title).toBe("Budget");
    expect(r.tabs).toEqual([expect.objectContaining({ title: "Data", rows: 1000, columns: 26 }), expect.objectContaining({ title: "It's", rows: 50, columns: 5 })]);
  });

  it("#C82 gsheets_get lists title and every tab with sheetId, title and row/column grid sizes (incl. a 1×1 tab)", async () => {
    const h = host({ tabs: [{ title: "Data", rows: 1000, cols: 26 }, { title: "Empty", rows: 1, cols: 1 }] });
    const r = jsonOf<{ title: string; tabs: Array<{ id: number; title: string; rows: number; columns: number }> }>(await h.run("gsheets_get", { account: "work", spreadsheetId: ID }));
    expect(r.title).toBe("Budget");
    // the tool names Google's per-tab `sheetId` as `id` (tool description: "tabs (id, name, rows, columns)")
    expect(r.tabs).toEqual([
      expect.objectContaining({ id: 0, title: "Data", rows: 1000, columns: 26 }),
      expect.objectContaining({ id: 1, title: "Empty", rows: 1, columns: 1 }),
    ]);
  });

  it("#C83 `A:Z` of a 50 000×26 tab: ≤ 10 000 cells per call, truncated + nextRange; walking nextRange returns every row exactly once", async () => {
    const h = host({ tabs: [{ title: "Data", rows: 50_000, cols: 26 }] });
    h.google.on("GET", /\/values\//, generate);
    const first = await read(h, "Data!A:Z");
    expect(first.cells).toBe(384 * 26);
    expect(first.cells).toBeLessThanOrEqual(10_000);
    expect(first.truncated).toBe(true);
    expect(first.nextRange).toBe("Data!A385:Z50000");
    const seen: string[] = [];
    let page: Read = first;
    for (let guard = 0; ; guard++) {
      expect(guard, "walking nextRange must terminate").toBeLessThan(200);
      expect(page.cells).toBeLessThanOrEqual(10_000);
      for (const row of page.values) seen.push(String(row[0]));
      if (!page.nextRange) break;
      expect(page.truncated).toBe(true);
      page = await read(h, page.nextRange);
    }
    expect(seen).toHaveLength(50_000);
    expect(seen).toEqual(Array.from({ length: 50_000 }, (_, i) => `r${i + 1}c1`));
    expect(page.truncated).toBeUndefined();
  });

  it("#C84 10 000 cells are not truncated; 10 001 → 10 000 + nextRange of the one remaining cell; 9 999 not truncated", async () => {
    for (const [last, truncated] of [[9999, false], [10000, false], [10001, true]] as const) {
      const h = host();
      h.google.on("GET", /\/values\//, generate);
      const r = await read(h, `A1:A${last}`);
      if (!truncated) {
        expect(r.cells).toBe(last);
        expect(r.truncated).toBeUndefined();
        expect(r.nextRange).toBeUndefined();
        expect(sentRanges(h)).toEqual([`A1:A${last}`]);
      } else {
        expect(r.cells).toBe(10_000);
        expect(r.values).toHaveLength(10_000);
        expect(r.truncated).toBe(true);
        expect(r.nextRange).toBe("A10001:A10001");
        expect(sentRanges(h)).toEqual(["A1:A10000"]);
      }
      expect(h.google.to("GET", SHEET), "a bounded range needs no metadata").toHaveLength(0);
    }
  });

  it("#C84 `A:Z` of a 50 000-row tab → whole rows up to 10 000 cells and the next range to continue", async () => {
    const h = host({ tabs: [{ title: "Data", rows: 50_000, cols: 26 }] });
    h.google.on("GET", /\/values\//, generate);
    const r = await read(h, "Data!A:Z");
    expect(sentRanges(h)).toEqual(["Data!A1:Z384"]);
    expect(r.cells).toBe(384 * 26);
    expect(r.truncated).toBe(true);
    expect(r.nextRange).toBe("Data!A385:Z50000");
  });

  it("#C85 ragged rows come back as Google gives them; `Data!A1:B2` and a quoted tab are sent verbatim", async () => {
    const h = host();
    h.google.on("GET", /\/values\//, { json: { range: "Data!A1:B2", values: [["a"], ["b", "", "c"]] } });
    const r = await read(h, "Data!A1:B2");
    expect(r.values).toEqual([["a"], ["b", "", "c"]]);
    expect(r.cells).toBe(4);
    await read(h, "'It''s'!A1:B2");
    expect(sentRanges(h)).toEqual(["Data!A1:B2", "'It''s'!A1:B2"]);
    // …and an escaped tab name is rebuilt correctly when the read has to continue
    const big = host();
    big.google.on("GET", /\/values\//, generate);
    const t = await read(big, "'It''s'!A1:A10002");
    expect(t.nextRange).toBe("'It''s'!A10001:A10002");
  });

  it("#C85 an invalid A1 range (`Z0`) → sheets_error from Google's 400, not retried", async () => {
    const h = host();
    h.google.on("GET", /\/values\//, googleError(400, "badRequest", undefined, "Unable to parse range: Z0"));
    const e = await err(h.run("gsheets_read", { account: "work", spreadsheetId: ID, range: "Z0" }));
    expect(e?.code).toBe("sheets_error");
    expect(e?.status).toBe(400);
    expect(sentRanges(h)).toEqual(["Z0"]);
  });

  it("#C86/#GC17 a single row wider than the cap is still returned whole; paging strictly advances and ends", async () => {
    const h = host();
    h.google.on("GET", /\/values\//, generate);
    const r = await read(h, `A1:${col(10_001)}1`);
    expect(r.cells).toBe(10_001);
    expect(r.truncated).toBeUndefined();
    // two (three) such rows → one full row per page, each nextRange moves on by a row
    const wide = host();
    wide.google.on("GET", /\/values\//, generate);
    const seen: string[] = [];
    let range: string | undefined = `A1:${col(10_001)}3`;
    while (range && seen.length < 10) {
      seen.push(range);
      const page: Read = await read(wide, range);
      expect(page.cells).toBe(10_001);
      range = page.nextRange;
    }
    expect(seen).toEqual([`A1:${col(10_001)}3`, `A2:${col(10_001)}3`, `A3:${col(10_001)}3`]);
    expect(sentRanges(wide)).toEqual([`A1:${col(10_001)}1`, `A2:${col(10_001)}2`, `A3:${col(10_001)}3`]);
  });
});

const rows3x4 = [["a", "b", "c", "d"], [1, 2, 3, 4], [true, null, "x", "y"]];

describe("Sheets write tools", () => {
  it("#C87 preview names account, spreadsheet, tab, range, '12 cells' and the first rows; the PUT goes to that range", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ updated: boolean; updatedCells: number }>(await h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!B2", values: rows3x4 }, ui.ctx));
    const text = confirmText(ui);
    expect(text).toContain(`Account: ${ME}`);
    expect(text).toContain("Budget");
    expect(text).toContain("Tab: Data");
    expect(text).toContain("Range: Data!B2:E4");
    expect(text).toContain("12 (3 rows x 4 columns)");
    expect(text).toContain("- a | b | c | d");
    expect(text).toContain("- true | | x | y");
    const put = h.google.writes()[0] as FakeRequest;
    expect(put.method).toBe("PUT");
    expect(decodeURIComponent(put.path)).toBe(`${SHEET}/values/Data!B2:E4`);
    expect(put.body).toMatchObject({ values: rows3x4 });
    expect(r.updated).toBe(true);
    expect(h.grid.get("Data!E4")?.value).toBe("y");
  });

  it("#C87/#GC3 only the first 5 rows are shown; the request carries every row", async () => {
    const h = host();
    const ui = uiCtx(true);
    const values = Array.from({ length: 8 }, (_, i) => [`row${i}`]);
    await h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!A1", values }, ui.ctx);
    expect(confirmText(ui)).toContain("+3 more rows (8 total)");
    expect(confirmText(ui)).not.toContain("row5");
    expect(((h.google.writes()[0] as FakeRequest).body as { values: unknown[] }).values).toHaveLength(8);
  });

  it("#C88/#GC18 ragged rows (3,4,2): extent = rows × widest row from the anchor (C18); 1 cell; a larger range is only an anchor", async () => {
    const h = host();
    await h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!B2", values: [[1, 2, 3], [1, 2, 3, 4], [1, 2]] }, uiCtx(true).ctx);
    expect(decodeURIComponent(h.google.writes()[0]?.path ?? "")).toContain("/values/Data!B2:E4");
    await h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!C3:Z99", values: [["only"]] }, uiCtx(true).ctx);
    expect(decodeURIComponent(h.google.writes()[1]?.path ?? "")).toContain("/values/Data!C3:C3");
    expect(h.grid.get("Data!C3")?.value).toBe("only");
  });

  it("#C88 empty / malformed values → invalid_params before any dialog or request; an unknown tab → sheets_error before the dialog", async () => {
    for (const values of [[], [[]], [[], []], "x", [["a"], "b"], [[{ a: 1 }]], [[Number.NaN]]]) {
      const h = host();
      const ui = uiCtx(true);
      expect((await err(h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!A1", values }, ui.ctx)))?.code, JSON.stringify(values)).toBe("invalid_params");
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(h.google.calls).toHaveLength(0);
    }
    const h = host();
    const ui = uiCtx(true);
    const e = await err(h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Nope!A1", values: [["x"]] }, ui.ctx));
    expect(e?.code).toBe("sheets_error");
    expect(e?.message).toContain("Data");
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.writes()).toHaveLength(0);
  });

  it("#C89 append: values:append with insertDataOption, result shows updatedRange; the dialog shows tab + row count", async () => {
    const h = host();
    for (let r = 1; r <= 5; r++) for (const c of ["A", "B", "C"]) h.grid.set(`Data!${c}${r}`, { value: "old", formula: false });
    const ui = uiCtx(true);
    const r = jsonOf<{ appended: boolean; updatedRange: string; updatedRows: number }>(
      await h.run("gsheets_append", { account: "work", spreadsheetId: ID, range: "Data!A1:C5", values: [["x", 1, 2], ["y", 3, 4]] }, ui.ctx),
    );
    const text = confirmText(ui);
    expect(text).toContain("Tab: Data");
    expect(text).toContain("Rows appended: 2");
    expect(text).toContain("Budget");
    const post = h.google.writes()[0] as FakeRequest;
    expect(decodeURIComponent(post.path)).toBe(`${SHEET}/values/Data!A1:C5:append`);
    expect(post.query).toMatchObject({ insertDataOption: "INSERT_ROWS", valueInputOption: "RAW" });
    expect(r).toMatchObject({ appended: true, updatedRange: "Data!A6:C7", updatedRows: 2 });
    expect(h.grid.get("Data!A6")?.value).toBe("x");
  });

  it("#C90 create: id + URL returned; the dialog shows the title and tabs (no spreadsheet or tab exists yet)", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ created: boolean; spreadsheetId: string; url: string; tabs: string[] }>(await h.run("gsheets_create", { account: "work", title: "Plan 2026", tabs: ["Q1", "Q2"], values: [["h1", "h2"], [1, 2]] }, ui.ctx));
    expect(r).toMatchObject({ created: true, spreadsheetId: "new123", url: expect.stringContaining("new123"), tabs: ["Q1", "Q2"], valuesWritten: true });
    const text = confirmText(ui);
    expect(text).toContain("New spreadsheet: Plan 2026");
    expect(text).toContain("Tabs (2): Q1, Q2");
    expect(text).toContain("4 cells");
    const [post, put] = h.google.writes();
    expect(post?.body).toMatchObject({ properties: { title: "Plan 2026" }, sheets: [{ properties: { title: "Q1" } }, { properties: { title: "Q2" } }] });
    expect(decodeURIComponent(put?.path ?? "")).toBe("/spreadsheets/new123/values/'Q1'!A1:B2");
    expect(put?.query.valueInputOption).toBe("RAW");
    expect(h.google.to("GET")).toHaveLength(0);
  });

  it("#C90 create with a title only → a single POST, no values request", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ valuesWritten?: boolean }>(await h.run("gsheets_create", { account: "work", title: "Empty" }, ui.ctx));
    expect(h.google.writes()).toHaveLength(1);
    expect(r.valuesWritten).toBeUndefined();
    expect(confirmText(ui)).toContain("Tabs: default");
  });

  it("#C91 deny / dismiss / no UI on create, write and append → 0 write requests, the grid is unchanged", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["gsheets_create", { title: "T", values: [["x"]] }],
      ["gsheets_write", { spreadsheetId: ID, range: "Data!A1", values: [["x"]] }],
      ["gsheets_append", { spreadsheetId: ID, range: "Data", values: [["x"]] }],
    ];
    for (const [tool, args] of calls) {
      for (const answer of [false, "throw"] as const) {
        const h = host();
        const e = await err(h.run(tool, { account: "work", ...args }, uiCtx(answer).ctx));
        expect(e?.code, `${tool} ${answer}`).toBe("denied");
        expect(h.google.writes(), `${tool} ${answer}`).toHaveLength(0);
        expect(h.grid.size).toBe(0);
      }
      const h = host();
      expect((await err(h.run(tool, { account: "work", ...args }, NO_UI)))?.code, tool).toBe("blocked");
      expect(h.google.calls).toHaveLength(0);
    }
  });

  it("#C91 a write tool on a Sheets level `read` account is refused (level_insufficient) — no dialog, no HTTP", async () => {
    const h = host({ account: { products: { sheets: "read" } } });
    const ui = uiCtx(true);
    const e = await err(h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!A1", values: [["x"]] }, ui.ctx));
    expect(e?.code).toBe("level_insufficient");
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.calls).toHaveLength(0);
  });
});

describe("Values are written literally", () => {
  const FORMULAS = ['=IMPORTXML("https://x","//a")', "=1+1", "+5", "@x", "'=1", "0123", "1e3", "true"];

  it("#C92/#GC19 formula text stays text: RAW, and the fake stores the literal strings", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!A1", values: [FORMULAS] }, ui.ctx);
    const put = h.google.writes()[0] as FakeRequest;
    expect(put.query.valueInputOption).toBe("RAW");
    expect(put.query.valueInputOption).not.toBe("USER_ENTERED");
    FORMULAS.forEach((v, i) => expect(h.grid.get(`Data!${col(i + 1)}1`)).toEqual({ value: v, formula: false }));
    expect(h.grid.get("Data!B1")?.value).toBe("=1+1");
    expect(h.grid.get("Data!F1")?.value).toBe("0123");
    expect(confirmText(ui)).toContain("written literally");
    expect(confirmText(ui)).not.toContain("Formula cells");
    // append is literal too
    await h.run("gsheets_append", { account: "work", spreadsheetId: ID, range: "Data", values: [["=1+1"]] }, uiCtx(true).ctx);
    expect(h.google.writes()[1]?.query.valueInputOption).toBe("RAW");
  });

  it("#C93 evaluate_formulas:true → USER_ENTERED; the dialog says formulas will be evaluated and lists exactly the formula cells (A1 refs)", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run(
      "gsheets_write",
      { account: "work", spreadsheetId: ID, range: "Data!A1", values: [["x", "=SUM(A1:A3)", "y"], ["z", "w", "q"], ["r", "s", "t"], ["u", "v", '=IMPORTXML("https://x","//a")']], evaluate_formulas: true },
      ui.ctx,
    );
    const text = confirmText(ui);
    expect(text).toContain("formulas WILL be evaluated");
    expect(text.split("\n").find((l) => l.startsWith("Formula cells"))).toBe("Formula cells (2): B1, C4"); // refs, not values
    expect(h.google.writes()[0]?.query.valueInputOption).toBe("USER_ENTERED");
    expect(h.grid.get("Data!B1")?.formula).toBe(true);
    // append: evaluated too
    const ui2 = uiCtx(true);
    await h.run("gsheets_append", { account: "work", spreadsheetId: ID, range: "Data!A1", values: [["=1+1"]], evaluate_formulas: true }, ui2.ctx);
    expect(confirmText(ui2)).toContain("Formula cells (1): A1");
    expect(h.google.writes()[1]?.query.valueInputOption).toBe("USER_ENTERED");
  });

  it("#C94/#GC19 evaluate_formulas:true with no formula cell → says evaluation is on with 0 formula cells; still USER_ENTERED", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!A1", values: [["a", 5, "+5", null]], evaluate_formulas: true }, ui.ctx);
    const text = confirmText(ui);
    expect(text).toContain("formulas WILL be evaluated");
    expect(text).toContain("Formula cells: none (0)");
    expect(h.google.writes()[0]?.query.valueInputOption).toBe("USER_ENTERED");
  });

  it("#C95 5 000 formula cells: the listed refs are bounded with the count; the request carries all of them", async () => {
    const h = host();
    const ui = uiCtx(true);
    const values = Array.from({ length: 5000 }, (_, i) => [`=A${i + 1}*2`]);
    await h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!B1", values, evaluate_formulas: true }, ui.ctx);
    const text = confirmText(ui);
    expect(text).toContain("formulas WILL be evaluated");
    expect(text).toContain("Formula cells (5000):");
    expect(text).toContain("+4980 more (5000 total)");
    expect(text).not.toContain("B21,");
    expect(text.length).toBeLessThan(2300);
    const put = h.google.writes()[0] as FakeRequest;
    expect((put.body as { values: unknown[][] }).values).toHaveLength(5000);
    expect(put.query.valueInputOption).toBe("USER_ENTERED");
  });

  it("a write over 10 000 cells is refused before any dialog", async () => {
    const h = host();
    const ui = uiCtx(true);
    const e = await err(h.run("gsheets_write", { account: "work", spreadsheetId: ID, range: "Data!A1", values: Array.from({ length: 10_001 }, () => ["x"]) }, ui.ctx));
    expect(e?.code).toBe("invalid_params");
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.calls).toHaveLength(0);
  });
});
