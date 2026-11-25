/**
 * L1 Docs tools (test-plan #C71–#C81; tasks 12.70–12.80) against the REAL lease handler and a fake Google Docs:
 * Markdown read shape + paging, confirmed writes, literal replace, and the `revisionId` write guard.
 * See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { gdocs } from "../tools/gdocs.js";
import { createFakeGoogle, type FakeGoogle, googleError, jsonOf, makeToolHost, NO_UI, textOf, uiCtx } from "./fake-google.js";

const ME = "a@x.com";
const WORK = { sub: "s1", email: ME, alias: "work", products: { docs: "write" } } as const;

interface FakeDoc {
  title: string;
  /** Flat body text, each paragraph ends with "\n" (an empty doc is "\n"). Indices are UTF-16 units from 1. */
  text: string;
  rev: number;
  /** Replaces the generated `body.content` (rich fixtures). */
  content?: unknown[];
  lists?: Record<string, unknown>;
}

const para = (text: string, extra: Record<string, unknown> = {}) => ({ paragraph: { elements: [{ textRun: { content: `${text}\n` } }], ...extra } });

function contentOf(text: string): unknown[] {
  const out: unknown[] = [{ endIndex: 1, sectionBreak: {} }];
  let at = 1;
  for (const p of text.split("\n").slice(0, -1)) {
    out.push({ startIndex: at, endIndex: at + p.length + 1, ...para(p) });
    at += p.length + 1;
  }
  return out;
}

const PRECONDITION = {
  status: 400,
  json: { error: { code: 400, message: "Precondition check failed.", status: "FAILED_PRECONDITION" } },
};

/** A tiny stateful Docs backend: GET one doc, create, batchUpdate (insertText / replaceAllText with the revision guard). */
function docs(google: FakeGoogle, initial: Record<string, FakeDoc>) {
  const store = new Map<string, FakeDoc>(Object.entries(initial));
  const rev = (d: FakeDoc) => `r${d.rev}`;
  google
    .on("GET", /^\/documents\/[^/:]+$/, (req) => {
      const id = req.path.split("/").pop() ?? "";
      const d = store.get(id);
      if (!d) return googleError(404, "notFound", undefined, "Not Found");
      return { json: { documentId: id, title: d.title, revisionId: rev(d), body: { content: d.content ?? contentOf(d.text) }, ...(d.lists ? { lists: d.lists } : {}) } };
    })
    .on("POST", "/documents", (req) => {
      const id = `new${store.size + 1}`;
      const title = (req.body as { title: string }).title;
      store.set(id, { title, text: "\n", rev: 1 });
      return { json: { documentId: id, title, revisionId: "r1" } };
    })
    .on("POST", /^\/documents\/[^/:]+:batchUpdate$/, (req) => {
      const id = (req.path.split("/")[2] ?? "").split(":")[0] ?? "";
      const d = store.get(id) as FakeDoc;
      const body = req.body as { requests: Array<Record<string, any>>; writeControl?: { requiredRevisionId?: string } };
      const required = body.writeControl?.requiredRevisionId;
      if (required !== undefined && required !== rev(d)) return PRECONDITION;
      const replies: unknown[] = [];
      for (const r of body.requests) {
        if (r.insertText) {
          const at = (r.insertText.location.index as number) - 1;
          d.text = d.text.slice(0, at) + r.insertText.text + d.text.slice(at);
          replies.push({});
        } else if (r.replaceAllText) {
          const { text, matchCase } = r.replaceAllText.containsText as { text: string; matchCase: boolean };
          const flags = matchCase ? "g" : "gi";
          const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
          const n = (d.text.match(re) ?? []).length;
          d.text = d.text.replace(re, () => r.replaceAllText.replaceText as string);
          replies.push({ replaceAllText: { occurrencesChanged: n } });
        }
      }
      d.content = undefined;
      d.rev += 1;
      return { json: { documentId: id, replies, writeControl: { requiredRevisionId: rev(d) } } };
    });
  return store;
}

function host(initial: Record<string, FakeDoc> = { D1: { title: "Plan", text: "Q1 goals\nQ1 risks\nlater Q1\n", rev: 1 } }, level = "write") {
  const google = createFakeGoogle();
  const store = docs(google, initial);
  const h = makeToolHost({ accounts: [{ ...WORK, products: { docs: level } } as never], google, products: [gdocs] });
  return { ...h, store };
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
const batchBodies = (google: FakeGoogle) => google.to("POST", /:batchUpdate$/).map((r) => r.body as { requests: Array<Record<string, any>>; writeControl?: { requiredRevisionId?: string } });

describe("gdocs_get — Markdown read (#C71, #C72)", () => {
  it("#C71/#GC13 shows heading / list / table markers, takes a Docs URL, and returns the revision id", async () => {
    const h = host({
      DOC1: {
        title: "Spec",
        text: "",
        rev: 3,
        lists: { L1: { listProperties: { nestingLevels: [{ glyphSymbol: "●" }, { glyphSymbol: "○" }] } }, L2: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } } },
        content: [
          { endIndex: 1, sectionBreak: {} },
          para("Overview", { paragraphStyle: { namedStyleType: "HEADING_1" } }),
          para("Details", { paragraphStyle: { namedStyleType: "HEADING_2" } }),
          para("plain text"),
          para("first", { bullet: { listId: "L1", nestingLevel: 0 } }),
          para("nested", { bullet: { listId: "L1", nestingLevel: 1 } }),
          para("step", { bullet: { listId: "L2" } }),
          {
            table: {
              rows: 2,
              columns: 2,
              tableRows: [
                { tableCells: [{ content: [para("A1")] }, { content: [para("B|1")] }] },
                { tableCells: [{ content: [para("A\\2")] }, { content: [para("B2")] }] },
              ],
            },
          },
        ],
      },
    });
    const r = jsonOf<{ title: string; revisionId: string; text: string; documentId: string }>(await h.run("gdocs_get", { account: "work", document: "https://docs.google.com/document/d/DOC1/edit" }, NO_UI));
    expect(r.documentId).toBe("DOC1");
    expect(r.title).toBe("Spec");
    expect(r.revisionId).toBe("r3");
    expect(r.text.split("\n")).toEqual(["# Overview", "## Details", "plain text", "- first", "  - nested", "1. step", "| A1 | B\\|1 |", "| --- | --- |", "| A\\\\2 | B2 |"]);
    expect(h.google.to("GET")[0]?.path).toBe("/documents/DOC1");
  });

  it("#C71 an empty doc gives an empty body and a valid revision id; a bare id works too", async () => {
    const h = host({ EMPTY: { title: "Blank", text: "\n", rev: 1 } });
    const r = jsonOf<{ text: string; revisionId: string; nextOffset?: number }>(await h.run("gdocs_get", { account: "work", document: "EMPTY" }, NO_UI));
    expect(r.text).toBe("");
    expect(r.revisionId).toBe("r1");
    expect(r.nextOffset).toBeUndefined();
  });

  it("#C71 rejects an id/URL that is not a Google Doc, before any lease", async () => {
    const h = host();
    for (const document of ["", "https://evil.example/document/d/D1/edit", "https://docs.google.com/spreadsheets/d/D1/edit", "a b/../c"]) {
      expect((await err(h.run("gdocs_get", { account: "work", document }, NO_UI)))?.code).toBe("invalid_params");
    }
    expect(h.leaseCalls()).toHaveLength(0);
  });

  it("#C70 id resolution: bare id, /edit, /edit?tab…#heading, /u/1/ URL all resolve to the id; sheets URL, `javascript:` and an id with `/` fail before any HTTP", async () => {
    const valid = [
      "DOC1",
      "https://docs.google.com/document/d/DOC1/edit",
      "https://docs.google.com/document/d/DOC1/edit?tab=t.0#heading=h.x",
      "https://docs.google.com/document/u/1/d/DOC1/edit",
    ];
    for (const document of valid) {
      const h = host({ DOC1: { title: "Spec", text: "hi\n", rev: 4 } });
      const r = jsonOf<{ documentId: string; title: string; revisionId: string }>(await h.run("gdocs_get", { account: "work", document }, NO_UI));
      expect(r).toMatchObject({ documentId: "DOC1", title: "Spec", revisionId: "r4" });
      expect(h.google.to("GET").map((c) => c.path)).toEqual(["/documents/DOC1"]);
    }
    for (const document of ["https://docs.google.com/spreadsheets/d/DOC1/edit", "javascript:alert(1)", "DOC1/../x"]) {
      const h = host({ DOC1: { title: "Spec", text: "hi\n", rev: 4 } });
      expect((await err(h.run("gdocs_get", { account: "work", document }, NO_UI)))?.code).toBe("invalid_params");
      expect(h.google.calls).toHaveLength(0);
      expect(h.leaseCalls()).toHaveLength(0);
    }
  });

  const pageOf = async (h: ReturnType<typeof host>, offset?: number) =>
    jsonOf<{ text: string; offset: number; total: number; nextOffset?: number }>(await h.run("gdocs_get", { account: "work", document: "D1", ...(offset === undefined ? {} : { offset }) }, NO_UI));

  it.each([
    [19_999, false],
    [20_000, false],
    [20_001, true],
  ])("#C72 a %i-char body %s a continuation", async (n, more) => {
    const h = host({ D1: { title: "Big", text: `${"x".repeat(n)}\n`, rev: 1 } });
    const first = await pageOf(h);
    expect(first.total).toBe(n);
    expect(first.nextOffset !== undefined).toBe(more);
    let body = first.text;
    for (let next = first.nextOffset; next !== undefined; ) {
      const page = await pageOf(h, next);
      body += page.text;
      next = page.nextOffset;
    }
    expect(body).toBe("x".repeat(n));
  });

  it("#C72/#GC6 paging never splits a surrogate pair and loses / duplicates nothing", async () => {
    const full = `a${"\u{1F600}".repeat(20_001)}`; // the 20 000-unit cut falls inside a pair
    const h = host({ D1: { title: "Emoji", text: `${full}\n`, rev: 1 } });
    const pages: string[] = [];
    for (let next: number | undefined = 0; next !== undefined; ) {
      const page = await pageOf(h, next);
      pages.push(page.text);
      next = page.nextOffset;
    }
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) {
      expect(p).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(p).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
    expect(pages.join("")).toBe(full);
  });

  it("#C72 an offset beyond the end gives an empty page with no continuation; a negative offset is rejected", async () => {
    const h = host({ D1: { title: "Small", text: "hello\n", rev: 1 } });
    const past = await pageOf(h, 999);
    expect(past.text).toBe("");
    expect(past.nextOffset).toBeUndefined();
    expect((await err(pageOf(h, -1)))?.code).toBe("invalid_params");
  });
});

describe("gdocs write tools — confirm, preview, denial (#C73–#C77)", () => {
  it("#C73 replace preview names account, title, match, replacement and the count (3)", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ replaced: number }>(await h.run("gdocs_replace_text", { account: "work", document: "D1", match: "Q1", replacement: "Q2" }, ui.ctx));
    const msg = ui.confirm.mock.calls[0]?.[1] ?? "";
    expect(msg).toContain(ME);
    expect(msg).toContain("Plan");
    expect(msg).toContain("Q1");
    expect(msg).toContain("Q2");
    expect(msg).toMatch(/Matches: 3\b/);
    expect(r.replaced).toBe(3);
    expect(h.store.get("D1")?.text).toBe("Q2 goals\nQ2 risks\nlater Q2\n");
  });

  it("#C73/#GC14 0 matches: no confirmation, no write request, `no_match` with count 0", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ code: string; count: number }>(await h.run("gdocs_replace_text", { account: "work", document: "D1", match: "nothing here", replacement: "x" }, ui.ctx));
    expect(r).toMatchObject({ code: "no_match", count: 0 });
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.writes()).toHaveLength(0);
  });

  it("#C73 an empty replacement deletes the matches (still confirmed)", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gdocs_replace_text", { account: "work", document: "D1", match: " goals", replacement: "" }, ui.ctx);
    expect(h.store.get("D1")?.text).toBe("Q1\nQ1 risks\nlater Q1\n");
  });

  it("#C74 create: POST the doc, then insertText only when text is given; returns id + URL; preview shows title + text", async () => {
    const h = host();
    const ui = uiCtx(true);
    const plain = jsonOf<{ documentId: string; url: string; title: string }>(await h.run("gdocs_create", { account: "work", title: "T" }, ui.ctx));
    expect(plain).toMatchObject({ documentId: "new2", title: "T", url: "https://docs.google.com/document/d/new2/edit" });
    expect(h.google.to("POST", "/documents")[0]?.body).toEqual({ title: "T" });
    expect(batchBodies(h.google)).toHaveLength(0);

    const withText = jsonOf<{ documentId: string }>(await h.run("gdocs_create", { account: "work", title: "T", text: "Hello body" }, ui.ctx));
    const reqs = batchBodies(h.google);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.requests).toEqual([{ insertText: { location: { index: 1 }, text: "Hello body" } }]);
    expect(h.google.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/documents", "/documents", `/documents/${withText.documentId}:batchUpdate`]);
    const msg = ui.confirm.mock.calls[1]?.[1] ?? "";
    expect(msg).toContain("Title: T");
    expect(msg).toContain("Hello body");
    expect(ui.confirm.mock.calls[0]?.[1]).toContain("Text: (none)");
  });

  it("#C74 a 1 MB initial text is sent whole while the preview stays bounded", async () => {
    const h = host();
    const ui = uiCtx(true);
    const text = "y".repeat(1_048_576);
    await h.run("gdocs_create", { account: "work", title: "Big", text }, ui.ctx);
    expect(batchBodies(h.google)[0]?.requests[0]?.insertText?.text).toHaveLength(1_048_576);
    expect((ui.confirm.mock.calls[0]?.[1] ?? "").length).toBeLessThanOrEqual(2100);
  });

  it("#C74 a failing insert after create names the created document", async () => {
    const h = host();
    h.google.on("POST", /:batchUpdate$/, googleError(500, "backendError"));
    const e = await err(h.run("gdocs_create", { account: "work", title: "T", text: "x" }, uiCtx(true).ctx));
    expect(e?.message).toContain("new2");
    expect(e?.message).toMatch(/created/);
  });

  it("#C75 append inserts at the end-of-body index (not 0), text exact, emoji intact", async () => {
    const h = host({ D1: { title: "Plan", text: "hello\n", rev: 1 }, EMPTY: { title: "E", text: "\n", rev: 1 } });
    const text = "\nnew \u{1F600} line\nsecond";
    await h.run("gdocs_append_text", { account: "work", document: "D1", text }, uiCtx(true).ctx);
    await h.run("gdocs_append_text", { account: "work", document: "EMPTY", text }, uiCtx(true).ctx);
    const [a, b] = batchBodies(h.google);
    expect(a?.requests).toEqual([{ insertText: { location: { index: 6 }, text } }]);
    expect(b?.requests).toEqual([{ insertText: { location: { index: 1 }, text } }]);
    expect(h.store.get("D1")?.text).toBe(`hello${text}\n`);
  });

  it("#C76 a denial on create / append / replace sends nothing and leaves the doc unchanged", async () => {
    for (const answer of [false, "throw"] as const) {
      const h = host();
      const before = h.store.get("D1")?.text;
      const calls = [
        h.run("gdocs_create", { account: "work", title: "T", text: "x" }, uiCtx(answer).ctx),
        h.run("gdocs_append_text", { account: "work", document: "D1", text: "tail" }, uiCtx(answer).ctx),
        h.run("gdocs_replace_text", { account: "work", document: "D1", match: "Q1", replacement: "Q2" }, uiCtx(answer).ctx),
      ];
      for (const e of await Promise.all(calls.map(err))) expect(e?.code).toBe("denied");
      expect(h.google.writes()).toHaveLength(0);
      expect(h.store.get("D1")?.text).toBe(before);
      expect(h.store.size).toBe(1);
    }
  });

  it("#C76 no UI blocks all three before any HTTP call; level read blocks them too", async () => {
    const h = host();
    for (const [name, p] of [
      ["gdocs_create", { title: "T" }],
      ["gdocs_append_text", { document: "D1", text: "x" }],
      ["gdocs_replace_text", { document: "D1", match: "Q1", replacement: "Q2" }],
    ] as const) {
      expect((await err(h.run(name, { account: "work", ...p }, NO_UI)))?.code).toBe("blocked");
    }
    expect(h.google.calls).toHaveLength(0);
    const ro = host(undefined, "read");
    expect((await err(ro.run("gdocs_append_text", { account: "work", document: "D1", text: "x" }, uiCtx(true).ctx)))?.code).toBe("level_insufficient");
    expect(ro.google.calls).toHaveLength(0);
  });

  it("#C77 replace is literal (regex characters, matchCase) and an empty match is rejected before confirm", async () => {
    const h = host({ D1: { title: "Re", text: "cost.*(x) and COST.*(X) and axb\n", rev: 1 } });
    const ui = uiCtx(true);
    await h.run("gdocs_replace_text", { account: "work", document: "D1", match: ".*(", replacement: "#", matchCase: true }, ui.ctx);
    expect(batchBodies(h.google)[0]?.requests[0]).toEqual({ replaceAllText: { containsText: { text: ".*(", matchCase: true }, replaceText: "#" } });
    expect(h.store.get("D1")?.text).toBe("cost#x) and COST#X) and axb\n");

    // `a.b` as a regex would match "axb"; literally it matches nothing.
    const none = jsonOf<{ code: string }>(await h.run("gdocs_replace_text", { account: "work", document: "D1", match: "a.b", replacement: "!" }, ui.ctx));
    expect(none.code).toBe("no_match");

    // matchCase false is honoured in both the count shown and the request sent.
    await h.run("gdocs_replace_text", { account: "work", document: "D1", match: "COST", replacement: "price", matchCase: false }, ui.ctx);
    expect(ui.confirm.mock.calls.at(-1)?.[1]).toMatch(/Matches: 2\b/);
    expect(batchBodies(h.google).at(-1)?.requests[0]?.replaceAllText.containsText.matchCase).toBe(false);

    const before = ui.confirm.mock.calls.length;
    const leases = h.leaseCalls().length;
    expect((await err(h.run("gdocs_replace_text", { account: "work", document: "D1", match: "", replacement: "x" }, ui.ctx)))?.code).toBe("invalid_params");
    expect(ui.confirm.mock.calls.length).toBe(before);
    expect(h.leaseCalls().length).toBe(leases);
  });
});

describe("gdocs edits do not clobber concurrent changes (#C78–#C81)", () => {
  it("#C78/#GC15 a collaborator edits after gdocs_get: append with the old revision fails `revision_changed`, nothing applied", async () => {
    const h = host();
    const got = jsonOf<{ revisionId: string }>(await h.run("gdocs_get", { account: "work", document: "D1" }, NO_UI));
    expect(got.revisionId).toBe("r1");
    (h.store.get("D1") as FakeDoc).rev = 2; // someone else edited
    const before = h.store.get("D1")?.text;
    const e = await err(h.run("gdocs_append_text", { account: "work", document: "D1", text: "mine", revisionId: "r1" }, uiCtx(true).ctx));
    expect(e?.code).toBe("revision_changed");
    expect(e?.message).toMatch(/^revision_changed: /);
    expect(h.store.get("D1")?.text).toBe(before);
    expect(batchBodies(h.google)[0]?.writeControl).toEqual({ requiredRevisionId: "r1" });
  });

  it("#C79 a current revision applies and returns the new revision id; reusing the old one then fails", async () => {
    const h = host();
    const ui = uiCtx(true);
    const first = jsonOf<{ revisionId: string }>(await h.run("gdocs_append_text", { account: "work", document: "D1", text: "A", revisionId: "r1" }, ui.ctx));
    expect(first.revisionId).toBe("r2");
    expect((await err(h.run("gdocs_append_text", { account: "work", document: "D1", text: "B", revisionId: "r1" }, ui.ctx)))?.code).toBe("revision_changed");
    expect((await err(h.run("gdocs_replace_text", { account: "work", document: "D1", match: "Q1", replacement: "Q9", revisionId: "r1" }, ui.ctx)))?.code).toBe("revision_changed");
    const second = jsonOf<{ revisionId: string; replaced: number }>(await h.run("gdocs_replace_text", { account: "work", document: "D1", match: "Q1", replacement: "Q9", revisionId: "r2" }, ui.ctx));
    expect(second).toMatchObject({ revisionId: "r3", replaced: 3 });
  });

  it.each(["gdocs_append_text", "gdocs_replace_text"] as const)("#C80/#GC16 %s: omitted → guarded with the revision read for the dialog; current ok; stale fails; malformed rejected", async (name) => {
    const args = name === "gdocs_append_text" ? { text: "tail" } : { match: "Q1", replacement: "Q2" };
    const run = (h: ReturnType<typeof host>, revisionId?: unknown) =>
      h.run(name, { account: "work", document: "D1", ...args, ...(revisionId === undefined ? {} : { revisionId }) }, uiCtx(true).ctx);

    const omitted = host();
    await run(omitted);
    expect(batchBodies(omitted.google)[0]?.writeControl).toEqual({ requiredRevisionId: "r1" });

    const current = host();
    await run(current, "r1");
    expect(batchBodies(current.google)[0]?.writeControl).toEqual({ requiredRevisionId: "r1" });

    const stale = host();
    (stale.store.get("D1") as FakeDoc).rev = 5;
    expect((await err(run(stale, "r1")))?.code).toBe("revision_changed");

    const bad = host();
    for (const v of ["", 7, "x".repeat(300)]) expect((await err(run(bad, v)))?.code).toBe("invalid_params");
    expect(bad.leaseCalls()).toHaveLength(0);
    expect(bad.google.calls).toHaveLength(0);
  });

  it("#C81 the doc changes while the confirm dialog is open: the write still carries the old revision and fails", async () => {
    for (const [name, args] of [
      ["gdocs_append_text", { text: "tail" }],
      ["gdocs_replace_text", { match: "Q1", replacement: "Q2" }],
    ] as const) {
      const h = host();
      const before = h.store.get("D1")?.text;
      const ui = uiCtx(async () => {
        (h.store.get("D1") as FakeDoc).rev += 1; // a collaborator edits while the user is deciding
        return true;
      });
      const e = await err(h.run(name, { account: "work", document: "D1", ...args }, ui.ctx));
      expect(e?.code).toBe("revision_changed");
      expect(batchBodies(h.google)[0]?.writeControl).toEqual({ requiredRevisionId: "r1" });
      expect(h.store.get("D1")?.text).toBe(before);
    }
  });

  it("other batchUpdate failures stay `docs_error` (only FAILED_PRECONDITION maps to revision_changed)", async () => {
    const h = host();
    h.google.on("POST", /:batchUpdate$/, googleError(400, "invalidArgument"));
    const e = await err(h.run("gdocs_append_text", { account: "work", document: "D1", text: "x" }, uiCtx(true).ctx));
    expect(e?.code).toBe("docs_error");
  });

  it("results never leak the access token", async () => {
    const h = host();
    const r = await h.run("gdocs_append_text", { account: "work", document: "D1", text: "x" }, uiCtx(true).ctx);
    expect(textOf(r)).not.toContain("ACCESS-");
  });
});
