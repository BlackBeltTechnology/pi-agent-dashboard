/**
 * L1 Slides tools (test-plan #C96–#C101, #GC20; tasks 12.95–12.100, 12.136) against the REAL lease handler and a
 * fake Google Slides. See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { createFakeGoogle, type FakeGoogle, jsonOf, makeToolHost, NO_UI, uiCtx } from "./fake-google.js";

const WORK = { sub: "s1", email: "a@x.com", alias: "work", products: { slides: "write" } } as const;

interface Run {
  textRun?: { content: string };
}
const box = (id: string, text: string) => ({ objectId: id, shape: { text: { textElements: [{ textRun: { content: text } } as Run] } } });
const emptyBox = (id: string) => ({ objectId: id, shape: { shapeType: "RECTANGLE" } });
const image = (id: string) => ({ objectId: id, image: { contentUrl: "https://x/y.png" } });
const table = (id: string, rows: string[][]) => ({
  objectId: id,
  table: { tableRows: rows.map((r) => ({ tableCells: r.map((c) => ({ text: { textElements: [{ textRun: { content: c } }] } })) })) },
});
const slide = (id: string, elements: unknown[], notes?: string) => ({
  objectId: id,
  pageElements: elements,
  slideProperties: {
    notesPage: {
      notesProperties: { speakerNotesObjectId: `${id}_n` },
      pageElements: [box(`${id}_img`, "ignore me"), ...(notes === undefined ? [] : [box(`${id}_n`, notes)])],
    },
  },
});

interface Deck {
  presentationId: string;
  title: string;
  revisionId: string;
  slides: Array<ReturnType<typeof slide>>;
}
const deckOf = (n: number, over: Partial<Deck> = {}): Deck => ({
  presentationId: "deck1",
  title: "Q3 Plan",
  revisionId: "r1",
  slides: Array.from({ length: n }, (_, i) => slide(`s${i + 1}`, [box(`t${i + 1}`, `Title ${i + 1}\n`)], `Notes ${i + 1}`)),
  ...over,
});

const text = (el: { shape?: { text?: { textElements: Array<{ textRun?: { content: string } }> } } }) =>
  el.shape?.text?.textElements.map((t) => t.textRun?.content ?? "").join("") ?? "";

function occurrences(d: Deck, { text: needle, matchCase }: { text: string; matchCase: boolean }): number {
  const n = matchCase ? needle : needle.toLowerCase();
  let count = 0;
  for (const s of d.slides) {
    for (const el of s.pageElements as Array<Parameters<typeof text>[0]>) {
      const t = matchCase ? text(el) : text(el).toLowerCase();
      count += t.split(n).length - 1;
    }
  }
  return count;
}

/** A stateful deck behind the fake: GET, create, and batchUpdate with replaceAllText / createSlide / insertText + the revision guard. */
function slides(google: FakeGoogle, initial: Deck | undefined = deckOf(3)) {
  const state = { deck: initial, revision: 1 };
  const bump = () => {
    if (!state.deck) return;
    state.revision += 1;
    state.deck.revisionId = `r${state.revision}`;
  };
  google
    .on("GET", /^\/presentations\/[^/:]+$/, () => (state.deck ? { json: state.deck } : { status: 404, json: { error: { code: 404, message: "not found", status: "NOT_FOUND" } } }))
    .on("POST", "/presentations", (req) => {
      state.deck = { presentationId: "created1", title: (req.body as { title: string }).title, revisionId: "r1", slides: [] };
      return { json: state.deck };
    })
    .on("POST", /^\/presentations\/[^/:]+:batchUpdate$/, (req) => {
      const body = req.body as { requests: Array<Record<string, any>>; writeControl?: { requiredRevisionId?: string } };
      const d = state.deck as Deck;
      if (body.writeControl?.requiredRevisionId && body.writeControl.requiredRevisionId !== d.revisionId) {
        return { status: 400, json: { error: { code: 400, message: "The required revision ID doesn't match the latest revision.", status: "FAILED_PRECONDITION" } } };
      }
      const replies: unknown[] = [];
      for (const r of body.requests) {
        if (r.replaceAllText) {
          replies.push({ replaceAllText: { occurrencesChanged: occurrences(d, r.replaceAllText.containsText) } });
        } else if (r.createSlide) {
          d.slides.push(slide(r.createSlide.objectId, []));
          replies.push({ createSlide: { objectId: r.createSlide.objectId } });
        } else replies.push({});
      }
      bump();
      return { json: { presentationId: d.presentationId, replies, writeControl: { requiredRevisionId: d.revisionId } } };
    });
  return state;
}

function host(deck?: Deck, runtime: { confirmTimeoutMs?: number } = {}) {
  const google = createFakeGoogle();
  const state = slides(google, deck);
  const h = makeToolHost({ accounts: [WORK as never], google, runtime });
  return { ...h, state };
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string }) => e);
const confirmText = (c: ReturnType<typeof uiCtx>) => (c.confirm.mock.calls[0] as [string, string]).slice(0, 2).join("\n");
const batches = (h: ReturnType<typeof host>) => h.google.writes().filter((w) => w.path.endsWith(":batchUpdate"));
const writeControlOf = (h: ReturnType<typeof host>) => (batches(h)[0]?.body as { writeControl?: unknown } | undefined)?.writeControl;

describe("gslides_get", () => {
  it("#C96 a 12-slide deck → 12 entries with slide id, shape texts, notes; revisionId + title included", async () => {
    const h = host(deckOf(12));
    const out = jsonOf(await h.run("gslides_get", { account: "work", presentationId: "deck1" }, NO_UI)) as {
      title: string;
      revisionId: string;
      slides: Array<{ slideId: string; shapes: Array<{ text: string }>; notes: string }>;
    };
    expect(out.title).toBe("Q3 Plan");
    expect(out.revisionId).toBe("r1");
    expect(out.slides).toHaveLength(12);
    expect(out.slides[11]).toMatchObject({ slideId: "s12", shapes: [{ text: "Title 12" }], notes: "Notes 12" });
  });

  it("#C96 1 slide / 0 slides (→ []), shape with no text, image-only slide, missing notes, table shape", async () => {
    const odd = deckOf(0, {
      slides: [slide("a", [box("t", "Hello"), emptyBox("e"), table("tb", [["h1", "h2"], ["c1", "c2"]])]), slide("img", [image("i")], undefined)],
    });
    const h = host(odd);
    const out = jsonOf(await h.run("gslides_get", { account: "work", presentationId: "deck1" }, NO_UI)) as {
      slides: Array<{ slideId: string; shapes: Array<{ id: string; text: string }>; notes: string }>;
    };
    expect(out.slides[0]?.shapes).toEqual([
      { id: "t", text: "Hello" },
      { id: "tb", text: "h1 | h2\nc1 | c2", table: true },
    ]);
    expect(out.slides[0]?.notes).toBe("");
    expect(out.slides[1]).toEqual({ slideId: "img", shapes: [], notes: "" });

    const none = host(deckOf(0));
    const empty = jsonOf(await none.run("gslides_get", { account: "work", presentationId: "deck1" }, NO_UI)) as { slides: unknown[] };
    expect(empty.slides).toEqual([]);
    const one = jsonOf(await host(deckOf(1)).run("gslides_get", { account: "work", presentationId: "deck1" }, NO_UI)) as { slides: unknown[] };
    expect(one.slides).toHaveLength(1);
  });

  it("#C97 id and a presentation URL resolve to the id; a Docs URL is an argument error with 0 HTTP", async () => {
    for (const ref of ["deck1", "https://docs.google.com/presentation/d/deck1/edit#slide=id.p", "https://docs.google.com/presentation/u/0/d/deck1/edit"]) {
      const h = host();
      await h.run("gslides_get", { account: "work", presentationId: ref }, NO_UI);
      expect(h.google.calls[0]?.path, ref).toBe("/presentations/deck1");
    }
    for (const bad of ["https://docs.google.com/document/d/deck1/edit", "https://evil.example/presentation/d/deck1", "a b", ""]) {
      const h = host();
      const e = await err(h.run("gslides_get", { account: "work", presentationId: bad }, NO_UI));
      expect(e?.code, bad).toBe("invalid_params");
      expect(h.google.calls, bad).toHaveLength(0);
      expect(h.leaseCalls(), bad).toHaveLength(0);
    }
  });

  it("#GC6 (scenario-gate C6) a deck over 20 000 characters pages by slide with nextOffset; the next page continues", async () => {
    const big = deckOf(0, { slides: Array.from({ length: 5 }, (_, i) => slide(`b${i}`, [box("t", "x".repeat(9000))])) });
    const h = host(big);
    const p1 = jsonOf(await h.run("gslides_get", { account: "work", presentationId: "deck1" }, NO_UI)) as { slides: Array<{ slideId: string }>; nextOffset?: number };
    expect(p1.slides.map((s) => s.slideId)).toEqual(["b0", "b1"]);
    expect(p1.nextOffset).toBe(2);
    const p2 = jsonOf(await h.run("gslides_get", { account: "work", presentationId: "deck1", offset: 2 }, NO_UI)) as { slides: Array<{ slideId: string }>; nextOffset?: number };
    expect(p2.slides.map((s) => s.slideId)).toEqual(["b2", "b3"]);
    expect(p2.nextOffset).toBe(4);
    const p3 = jsonOf(await h.run("gslides_get", { account: "work", presentationId: "deck1", offset: 4 }, NO_UI)) as { slides: Array<{ slideId: string }>; nextOffset?: number };
    expect(p3.slides.map((s) => s.slideId)).toEqual(["b4"]);
    expect(p3.nextOffset).toBeUndefined();
  });
});

describe("write tools", () => {
  it("#C98 replace_text: dialog shows account, title, text and the match count; request is one replaceAllText guarded by the current revision", async () => {
    const h = host(deckOf(3, { slides: [slide("s1", [box("t", "Q3 Q3 goals")]), slide("s2", [box("t", "about Q3")])] }));
    const ui = uiCtx(true);
    const out = jsonOf(await h.run("gslides_replace_text", { account: "work", presentationId: "deck1", find: "Q3", replace: "Q4" }, ui.ctx)) as { replaced: number };
    const t = confirmText(ui);
    for (const part of ["Account: a@x.com", "Presentation: Q3 Plan", '"Q3"', '"Q4"', "3 match"]) expect(t).toContain(part);
    expect(out.replaced).toBe(3);
    const b = batches(h);
    expect(b).toHaveLength(1);
    expect(b[0]?.path).toBe("/presentations/deck1:batchUpdate");
    expect(b[0]?.body).toEqual({
      requests: [{ replaceAllText: { containsText: { text: "Q3", matchCase: true }, replaceText: "Q4" } }],
      writeControl: { requiredRevisionId: "r1" },
    });
  });

  it("#C98 add_slide TITLE_AND_BODY: dialog shows layout and texts; request has createSlide with the layout and the inserted texts", async () => {
    const h = host();
    const ui = uiCtx(true);
    const out = jsonOf(
      await h.run("gslides_add_slide", { account: "work", presentationId: "deck1", layout: "TITLE_AND_BODY", title: "Agenda", body: "One\nTwo" }, ui.ctx),
    ) as { added: boolean; slideId: string };
    const t = confirmText(ui);
    for (const part of ["Account: a@x.com", "Presentation: Q3 Plan", "Layout: TITLE_AND_BODY", "Title: Agenda", "Body: One"]) expect(t).toContain(part);
    expect(out.added).toBe(true);
    const body = batches(h)[0]?.body as { requests: Array<Record<string, any>>; writeControl: unknown };
    const create = body.requests[0]?.createSlide;
    expect(create.slideLayoutReference).toEqual({ predefinedLayout: "TITLE_AND_BODY" });
    expect(create.objectId).toBe(out.slideId);
    expect(create.placeholderIdMappings.map((m: { layoutPlaceholder: { type: string } }) => m.layoutPlaceholder.type)).toEqual(["TITLE", "BODY"]);
    const inserts = body.requests.slice(1).map((r) => ({ id: r.insertText.objectId, text: r.insertText.text }));
    expect(inserts).toEqual([
      { id: create.placeholderIdMappings[0].objectId, text: "Agenda" },
      { id: create.placeholderIdMappings[1].objectId, text: "One\nTwo" },
    ]);
    expect(body.writeControl).toEqual({ requiredRevisionId: "r1" });
  });

  it("#C98 create: dialog shows account and the title; one POST /presentations with that title", async () => {
    const h = host();
    const ui = uiCtx(true);
    const out = jsonOf(await h.run("gslides_create", { account: "work", title: "Roadmap" }, ui.ctx)) as { presentationId: string; title: string };
    const t = confirmText(ui);
    expect(t).toContain("Account: a@x.com");
    expect(t).toContain("Title: Roadmap");
    expect(h.google.writes()).toHaveLength(1);
    expect(h.google.writes()[0]?.path).toBe("/presentations");
    expect(h.google.writes()[0]?.body).toEqual({ title: "Roadmap" });
    expect(out).toMatchObject({ presentationId: "created1", title: "Roadmap" });
  });

  it("#GC14 (scenario-gate C14) replace with 0 matches: no confirmation, no write, `no_match` with count 0", async () => {
    const h = host();
    const ui = uiCtx(true);
    const out = jsonOf(await h.run("gslides_replace_text", { account: "work", presentationId: "deck1", find: "zzz", replace: "y" }, ui.ctx)) as { status: string; replaced: number };
    expect(out).toMatchObject({ status: "no_match", replaced: 0 });
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.writes()).toHaveLength(0);
  });

  it("#C99/#GC15 a stale revision fails the write with `revision_changed` and the deck is unchanged — replace_text and add_slide", async () => {
    const cases = [
      ["gslides_replace_text", { find: "Title", replace: "T" }],
      ["gslides_add_slide", { layout: "TITLE_ONLY", title: "New" }],
    ] as const;
    for (const [tool, args] of cases) {
      const h = host();
      const get = jsonOf(await h.run("gslides_get", { account: "work", presentationId: "deck1" }, NO_UI)) as { revisionId: string };
      expect(get.revisionId).toBe("r1");
      h.state.deck && (h.state.deck.revisionId = "r2"); // someone else edited
      const before = JSON.stringify(h.state.deck);
      const e = await err(h.run(tool, { account: "work", presentationId: "deck1", revisionId: "r1", ...args }, uiCtx(true).ctx));
      expect(e?.code, tool).toBe("revision_changed");
      expect(JSON.stringify(h.state.deck), tool).toBe(before);
      expect(writeControlOf(h), tool).toEqual({ requiredRevisionId: "r1" });
    }
  });

  it("#GC16 (scenario-gate C16) an omitted revisionId is read when the dialog is shown and guards the write; a malformed one is an argument error", async () => {
    const h = host();
    await h.run("gslides_replace_text", { account: "work", presentationId: "deck1", find: "Title 1", replace: "T" }, uiCtx(true).ctx);
    expect(writeControlOf(h)).toEqual({ requiredRevisionId: "r1" });

    const bad = host();
    for (const revisionId of ["", 7, "x".repeat(300)]) {
      const e = await err(bad.run("gslides_replace_text", { account: "work", presentationId: "deck1", find: "a", replace: "b", revisionId }, uiCtx(true).ctx));
      expect(e?.code, String(revisionId)).toBe("invalid_params");
    }
    expect(bad.google.calls).toHaveLength(0);
  });

  it("#C100 deny / dismiss / timeout on create, add_slide and replace_text → no batchUpdate and no create request", async () => {
    const answers = [
      ["deny", () => uiCtx(false)],
      ["dismiss", () => uiCtx("throw")],
      ["timeout", () => uiCtx("never")],
    ] as const;
    const calls = [
      ["gslides_create", { title: "T" }],
      ["gslides_add_slide", { presentationId: "deck1", layout: "TITLE_ONLY", title: "New" }],
      ["gslides_replace_text", { presentationId: "deck1", find: "Title 1", replace: "T" }],
    ] as const;
    for (const [name, make] of answers) {
      const h = host(undefined, { confirmTimeoutMs: 30 });
      for (const [tool, args] of calls) {
        const e = await err(h.run(tool, { account: "work", ...args }, make().ctx));
        expect(e?.code, `${name} ${tool}`).toBe("denied");
      }
      expect(h.google.writes(), name).toHaveLength(0);
    }
  });

  it("#C7 with no UI every Slides write is blocked before any HTTP call", async () => {
    const h = host();
    for (const [tool, args] of [
      ["gslides_create", { title: "T" }],
      ["gslides_add_slide", { presentationId: "deck1", layout: "BLANK" }],
      ["gslides_replace_text", { presentationId: "deck1", find: "a", replace: "b" }],
    ] as const) {
      expect((await err(h.run(tool, { account: "work", ...args }, NO_UI)))?.code, tool).toBe("blocked");
    }
    expect(h.google.calls).toHaveLength(0);
  });
});

describe("gslides_add_slide validation", () => {
  const LAYOUTS = ["BLANK", "CAPTION_ONLY", "TITLE", "TITLE_AND_BODY", "TITLE_AND_TWO_COLUMNS", "TITLE_ONLY", "SECTION_HEADER", "SECTION_TITLE_AND_DESCRIPTION", "ONE_COLUMN_TEXT", "MAIN_POINT", "BIG_NUMBER"];

  it("#C101/#GC20 an unknown layout is an argument error that lists every valid layout; 0 requests, no dialog", async () => {
    for (const layout of ["FOO", "title_and_body", ""]) {
      const h = host();
      const ui = uiCtx(true);
      const e = await err(h.run("gslides_add_slide", { account: "work", presentationId: "deck1", layout, title: "x" }, ui.ctx));
      expect(e?.code, layout).toBe("invalid_params");
      for (const l of LAYOUTS) expect(e?.message, layout).toContain(l);
      expect(h.google.calls, layout).toHaveLength(0);
      expect(ui.confirm).not.toHaveBeenCalled();
    }
  });

  const TEXT_FOR: Record<string, Record<string, string>> = Object.fromEntries(LAYOUTS.map((l): [string, Record<string, string>] => [l, l === "BLANK" ? {} : l === "CAPTION_ONLY" ? { body: "x" } : { title: "x" }]));

  it("#GC20 every Google predefined layout is accepted", async () => {
    for (const layout of LAYOUTS) {
      const h = host();
      await h.run("gslides_add_slide", { account: "work", presentationId: "deck1", layout, ...TEXT_FOR[layout] }, uiCtx(true).ctx);
      const body = batches(h)[0]?.body as { requests: Array<{ createSlide: { slideLayoutReference: unknown } }> };
      expect(body.requests[0]?.createSlide.slideLayoutReference, layout).toEqual({ predefinedLayout: layout });
    }
  });

  it("#C101 empty title and body, text for a layout without that placeholder, text over the placeholder capacity → error before the dialog, 0 requests", async () => {
    const bad: Array<Record<string, unknown>> = [
      { layout: "TITLE_AND_BODY" },
      { layout: "TITLE_AND_BODY", title: "", body: "" },
      { layout: "TITLE_AND_BODY", title: "   ", body: "  " },
      { layout: "BLANK", title: "no placeholder" },
      { layout: "TITLE_ONLY", title: "t", body: "no body placeholder" },
      { layout: "TITLE_AND_BODY", title: "t".repeat(1001) },
      { layout: "TITLE_AND_BODY", title: "t", body: "b".repeat(10_001) },
    ];
    for (const args of bad) {
      const h = host();
      const ui = uiCtx(true);
      const e = await err(h.run("gslides_add_slide", { account: "work", presentationId: "deck1", ...args }, ui.ctx));
      expect(e?.code, JSON.stringify(args).slice(0, 80)).toBe("invalid_params");
      expect(h.google.calls).toHaveLength(0);
      expect(ui.confirm).not.toHaveBeenCalled();
    }
  });

  it("#C101 text at the capacity limit is accepted", async () => {
    const h = host();
    await h.run("gslides_add_slide", { account: "work", presentationId: "deck1", layout: "TITLE_AND_BODY", title: "t".repeat(1000), body: "b".repeat(10_000) }, uiCtx(true).ctx);
    expect(batches(h)).toHaveLength(1);
  });
});
