/**
 * L1 cross-product scenario-gate decisions GC1–GC6 (test-plan #GC1–#GC6; tasks 12.117–12.122) run over the REAL tool list of
 * all seven Google products (Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts) with the REAL lease handler and a fake
 * Google. GC7–GC22 are covered where they live (Drive / server / per-product suites; their ids are in those test titles).
 * See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import type { Product } from "../../shared/products.js";
import { createFakeGoogle, googleError, type HostOptions, makeToolHost, NO_UI, uiCtx } from "./fake-google.js";

const SHEET_ID = "sheet1abcdef";
const X = "X".repeat(2000);

interface Row {
  product: Exclude<Product, "gmail">;
  /** The product's level that unlocks everything the app offers at its lowest tier (Drive `files`, others `read`). */
  read: string;
  /** A read tool call that issues exactly one GET. */
  readTool: [string, Record<string, unknown>];
  error: string;
  /** A POST create tool (not idempotent) and the path it POSTs to. */
  create: [string, Record<string, unknown>];
  /** A create call whose one free-text field is longer than the 500-char preview limit. */
  long: [string, Record<string, unknown>];
  /** Every write tool with minimal valid arguments (Drive: none — all its tools start at level `files`, the lowest). */
  writes: Array<[string, Record<string, unknown>]>;
}

const WHEN = { start: "2026-05-12T12:00:00+02:00", end: "2026-05-12T13:00:00+02:00" };
const ROWS: Row[] = [
  {
    product: "calendar", read: "read", readTool: ["gcal_calendars", {}], error: "calendar_error",
    create: ["gcal_event_create", { title: "Lunch", ...WHEN }],
    long: ["gcal_event_create", { title: "Lunch", ...WHEN, description: X }],
    writes: [
      ["gcal_event_create", { title: "Lunch", ...WHEN }],
      ["gcal_event_update", { eventId: "e1", title: "Moved" }],
      ["gcal_event_delete", { eventId: "e1" }],
      ["gcal_event_respond", { eventId: "e1", response: "accepted" }],
    ],
  },
  {
    product: "drive", read: "files", readTool: ["gdrive_search", {}], error: "drive_error",
    create: ["gdrive_create_folder", { name: "Reports" }],
    long: ["gdrive_create_folder", { name: "R".repeat(200) }],
    writes: [],
  },
  {
    product: "docs", read: "read", readTool: ["gdocs_get", { document: "D1" }], error: "docs_error",
    create: ["gdocs_create", { title: "T" }],
    long: ["gdocs_create", { title: "T", text: X }],
    writes: [
      ["gdocs_create", { title: "T" }],
      ["gdocs_append_text", { document: "D1", text: "x" }],
      ["gdocs_replace_text", { document: "D1", match: "a", replacement: "b" }],
    ],
  },
  {
    product: "sheets", read: "read", readTool: ["gsheets_get", { spreadsheetId: SHEET_ID }], error: "sheets_error",
    create: ["gsheets_create", { title: "Plan" }],
    long: ["gsheets_create", { title: "Plan", values: [[X]] }],
    writes: [
      ["gsheets_create", { title: "Plan" }],
      ["gsheets_write", { spreadsheetId: SHEET_ID, range: "Data!B2", values: [["x"]] }],
      ["gsheets_append", { spreadsheetId: SHEET_ID, range: "Data!A1", values: [["x"]] }],
    ],
  },
  {
    product: "slides", read: "read", readTool: ["gslides_get", { presentationId: "deck1" }], error: "slides_error",
    create: ["gslides_create", { title: "Roadmap" }],
    long: ["gslides_create", { title: "T".repeat(900) }],
    writes: [
      ["gslides_create", { title: "Roadmap" }],
      ["gslides_add_slide", { presentationId: "deck1", layout: "TITLE_AND_BODY", title: "Agenda", body: "One" }],
      ["gslides_replace_text", { presentationId: "deck1", find: "Q3", replace: "Q4" }],
    ],
  },
  {
    product: "tasks", read: "read", readTool: ["gtasks_lists", {}], error: "tasks_error",
    create: ["gtasks_create", { title: "Pay rent" }],
    long: ["gtasks_create", { title: "Pay rent", notes: X }],
    writes: [
      ["gtasks_create", { title: "x" }],
      ["gtasks_update", { taskId: "t1", title: "y" }],
      ["gtasks_complete", { taskId: "t1" }],
      ["gtasks_delete", { taskId: "t1" }],
    ],
  },
  {
    product: "contacts", read: "read", readTool: ["gcontacts_search", { query: "anna" }], error: "contacts_error",
    create: ["gcontacts_create", { givenName: "Cleo", familyName: "Nagy", emails: ["cleo@example.com"] }],
    long: ["gcontacts_create", { givenName: "Cleo", notes: X }],
    writes: [
      ["gcontacts_create", { givenName: "Cleo", emails: ["cleo@example.com"] }],
      ["gcontacts_update", { resourceName: "people/c1", organization: "B" }],
    ],
  },
];

const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
const levelOf = (row: Row, level: string) => ({ sub: "s1", email: "a@x.com", alias: "work", products: { [row.product]: level } });
const hostFor = (row: Row, level = row.read, runtime?: HostOptions["runtime"]) => {
  const google = createFakeGoogle();
  return makeToolHost({ accounts: [levelOf(row, level) as never], google, ...(runtime ? { runtime } : {}) });
};

describe("the table covers the real tool list (a new tool must be added to a row)", () => {
  it("every registered tool of the seven products appears in a row", () => {
    const h = makeToolHost({ accounts: [{ sub: "s1", email: "a@x.com", alias: "work" } as never] });
    const known = new Set(ROWS.flatMap((r) => [r.readTool[0], ...r.writes.map((w) => w[0])]));
    const writes = new Set(h.writes);
    expect(ROWS.map((r) => r.product).sort()).toEqual(["calendar", "contacts", "docs", "drive", "sheets", "slides", "tasks"]);
    for (const r of ROWS) for (const [name] of r.writes) expect(writes.has(name), `${name} is a write tool`).toBe(true);
    for (const name of writes) if (!name.startsWith("gdrive_") && !name.startsWith("probe_")) expect(known.has(name), `${name} is in the GC5 table`).toBe(true);
  });
});

describe.each(ROWS)("$product", (row) => {
  const [readName, readArgs] = row.readTool;
  const readOnce = (h: ReturnType<typeof hostFor>) => h.run(readName, { account: "work", ...readArgs }, NO_UI);

  it(`#GC1 (scenario-gate C1) ${readName}: Retry-After 86400 → rate_limited after 1 attempt; no header → 3 attempts total, waits 500 ms then 1000 ms, each ≤ 30 s`, async () => {
    const huge = hostFor(row);
    huge.google.on("GET", /.*/, { status: 429, headers: { "retry-after": "86400" }, json: {} });
    const e = await err(readOnce(huge));
    expect(e?.code).toBe("rate_limited");
    expect(huge.google.calls).toHaveLength(1);

    const waits: number[] = [];
    const always = hostFor(row, row.read, { sleep: async (ms: number) => void waits.push(ms), random: () => 0 });
    always.google.on("GET", /.*/, { status: 429, json: {} });
    expect((await err(readOnce(always)))?.code).toBe("rate_limited");
    expect(always.google.calls).toHaveLength(3);
    expect(waits).toEqual([500, 1000]);
    for (const w of waits) expect(w).toBeLessThanOrEqual(30_000);
  });

  it(`#GC2 (scenario-gate C2) a 503 on the read (GET) is retried; on ${row.create[0]} (POST) it is never retried — exactly one write request`, async () => {
    const waits: number[] = [];
    const get = hostFor(row, row.read, { sleep: async (ms: number) => void waits.push(ms), random: () => 0 });
    get.google.on("GET", /.*/, [{ status: 503, json: {} }, { status: 200, json: {} }]);
    await err(readOnce(get));
    expect(get.google.to("GET"), "GET 503 → retried").toHaveLength(2);

    const post = hostFor(row, row.product === "drive" ? "files" : "write");
    post.google.on("GET", /.*/, { json: {} }); // lookups some creates make first (default task list, …)
    post.google.on("POST", /.*/, [{ status: 503, json: {} }, { status: 200, json: {} }]);
    const e = await err(post.run(row.create[0], { account: "work", ...row.create[1] }, uiCtx(true).ctx));
    expect(e?.status).toBe(503);
    expect(post.google.to("POST"), "POST 503 → not retried").toHaveLength(1);
  });

  it(`#GC3 (scenario-gate C3) the ${row.long[0]} confirm text never carries a field longer than 500 chars`, async () => {
    const h = hostFor(row, row.product === "drive" ? "files" : "write");
    h.google.on("GET", /.*/, { json: {} });
    const ui = uiCtx(false);
    await err(h.run(row.long[0], { account: "work", ...row.long[1] }, ui.ctx));
    expect(ui.confirm, "the dialog was reached").toHaveBeenCalledTimes(1);
    const text = (ui.confirm.mock.calls[0] as unknown as string[]).slice(0, 2).join("\n");
    expect(text).not.toMatch(/(.)\1{500}/);
    expect(text.length).toBeLessThan(3000);
  });

  it(`#GC4 (scenario-gate C4) an unclassified 403 on ${readName} is \`${row.error}\` (not api_disabled / scope_insufficient)`, async () => {
    const h = hostFor(row);
    h.google.on("GET", /.*/, googleError(403, "forbidden", undefined, "nope"));
    expect((await err(readOnce(h)))?.code).toBe(row.error);
  });

  if (row.writes.length > 0) {
    it(`#GC5 (scenario-gate C5) every ${row.product} write tool at level \`read\` is level_insufficient naming Settings → Google accounts — before any HTTP call or dialog`, async () => {
      for (const [tool, args] of row.writes) {
        const h = hostFor(row, "read");
        const ui = uiCtx(true);
        const e = await err(h.run(tool, { account: "work", ...args }, ui.ctx));
        expect(e?.code, tool).toBe("level_insufficient");
        expect(e?.message, tool).toContain("Settings \u2192 Google accounts");
        expect(h.google.calls, tool).toHaveLength(0);
        expect(ui.confirm, tool).not.toHaveBeenCalled();
      }
    });
  } else {
    it("#GC5 n/a: every Drive tool starts at level `files`, the lowest — there is no read-level Drive state to refuse a write at", () => {
      expect(row.writes).toEqual([]);
    });
  }
});
