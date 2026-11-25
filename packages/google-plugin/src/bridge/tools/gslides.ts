/**
 * Google Slides tools (`gslides_*`, design D11; spec google-slides-tools). `gslides_get` needs Slides at level `read`;
 * `gslides_create` / `gslides_add_slide` / `gslides_replace_text` need `write` and are confirmed first (account,
 * presentation title, text preview or match count). Edits are guarded by a revision id (scenario-gate C15/C16): a
 * caller-supplied one goes into `writeControl.requiredRevisionId` as is and a stale one comes back from Google as
 * 400 `FAILED_PRECONDITION` → `revision_changed` (no pre-check); an omitted one is read when the dialog is shown.
 * Replace with 0 matches is not confirmed and changes nothing (C14). Layouts are Google's predefined enum (C20).
 * See change: add-google-connect.
 */
import { randomUUID } from "node:crypto";
import { TEXT_PAGE_CHARS } from "../paging.js";
import { optBool, optInt, type Params, reqStr } from "../params.js";
import { clip } from "../preview.js";
import { type Call, type ProductTools, Skip, type ToolOutput } from "../runtime.js";
import { GoogleToolError, invalidParams } from "../tool-error.js";

const enc = encodeURIComponent;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const URL_PATH = /^\/(?:u\/\d+\/)?presentation\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,200})(?:\/|$)/;
const TITLE_MAX = 1000;
const BODY_MAX = 10_000;
const FIND_MAX = 1000;

/** Each predefined layout → the placeholder types the `title` / `body` texts go into (none = the layout takes no text). */
const LAYOUTS = {
  BLANK: {},
  CAPTION_ONLY: { body: "SUBTITLE" },
  TITLE: { title: "CENTERED_TITLE", body: "SUBTITLE" },
  TITLE_AND_BODY: { title: "TITLE", body: "BODY" },
  TITLE_AND_TWO_COLUMNS: { title: "TITLE", body: "BODY" },
  TITLE_ONLY: { title: "TITLE" },
  SECTION_HEADER: { title: "TITLE" },
  SECTION_TITLE_AND_DESCRIPTION: { title: "TITLE", body: "SUBTITLE" },
  ONE_COLUMN_TEXT: { title: "TITLE", body: "BODY" },
  MAIN_POINT: { title: "TITLE" },
  BIG_NUMBER: { title: "TITLE" },
} as const satisfies Record<string, { title?: string; body?: string }>;
type Layout = keyof typeof LAYOUTS;
const LAYOUT_NAMES = Object.keys(LAYOUTS) as Layout[];

interface TextElement {
  textRun?: { content?: string };
}
interface Text {
  textElements?: TextElement[];
}
interface PageElement {
  objectId?: string;
  shape?: { text?: Text };
  table?: { tableRows?: Array<{ tableCells?: Array<{ text?: Text }> }> };
}
interface GSlide {
  objectId?: string;
  pageElements?: PageElement[];
  slideProperties?: { notesPage?: { notesProperties?: { speakerNotesObjectId?: string }; pageElements?: PageElement[] } };
}
interface Presentation {
  presentationId?: string;
  title?: string;
  revisionId?: string;
  slides?: GSlide[];
}
interface BatchReply {
  replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }>;
  writeControl?: { requiredRevisionId?: string };
}

// ───────────── argument parsing ─────────────

/** A presentation id, or a `docs.google.com/presentation/d/<id>/…` URL. Anything else (a Docs URL, another host) is an argument error. */
function presentationRef(p: Params): string {
  const v = reqStr(p, "presentationId", 2048).trim();
  if (ID.test(v)) return v;
  let url: URL | undefined;
  try {
    url = new URL(v);
  } catch {
    /* not a URL */
  }
  const id = url && url.protocol === "https:" && url.hostname === "docs.google.com" ? URL_PATH.exec(url.pathname)?.[1] : undefined;
  if (!id) throw invalidParams("`presentationId` must be a presentation id or a https://docs.google.com/presentation/d/<id>/… URL");
  return id;
}

/** Absent → undefined (the tool reads the current one); present → must be a non-empty string. */
function revisionArg(p: Params): string | undefined {
  return p.revisionId === undefined || p.revisionId === null ? undefined : reqStr(p, "revisionId", 200);
}

/** Texts are kept as given, but blank ones count as absent. */
function textArg(p: Params, name: string, max: number): string | undefined {
  const v = p[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw invalidParams(`\`${name}\` must be a string`);
  if (v.length > max) throw invalidParams(`\`${name}\` is longer than ${max} characters (the placeholder capacity)`);
  return v.trim() ? v : undefined;
}

function layoutArg(p: Params): Layout {
  const v = p.layout;
  if (typeof v !== "string" || !(LAYOUT_NAMES as string[]).includes(v)) throw invalidParams(`\`layout\` must be one of: ${LAYOUT_NAMES.join(", ")}`);
  return v as Layout;
}

// ───────────── result shaping ─────────────

const runsText = (t: Text | undefined): string => (t?.textElements ?? []).map((e) => e.textRun?.content ?? "").join("");
const trimEnd = (s: string) => s.replace(/\n$/, "");

/** All text of one element: a shape's runs, or a table as `a | b` rows. */
function elementText(el: PageElement): string {
  if (el.table) return (el.table.tableRows ?? []).map((r) => (r.tableCells ?? []).map((c) => trimEnd(runsText(c.text))).join(" | ")).join("\n");
  return trimEnd(runsText(el.shape?.text));
}

function shapesOf(s: GSlide): Array<{ id?: string; text: string; table?: true }> {
  const out: Array<{ id?: string; text: string; table?: true }> = [];
  for (const el of s.pageElements ?? []) {
    const text = elementText(el);
    if (text) out.push({ id: el.objectId, text, ...(el.table ? { table: true as const } : {}) });
  }
  return out;
}

function notesOf(s: GSlide): string {
  const np = s.slideProperties?.notesPage;
  const id = np?.notesProperties?.speakerNotesObjectId;
  const el = id ? (np?.pageElements ?? []).find((e) => e.objectId === id) : undefined;
  return el ? trimEnd(runsText(el.shape?.text)) : "";
}

const outline = (s: GSlide) => ({ slideId: s.objectId, shapes: shapesOf(s), notes: notesOf(s) });

/** Every text a `replaceAllText` can touch (slides' shapes and tables, speaker notes), for the match count shown in the dialog. */
function allTexts(d: Presentation): string[] {
  const out: string[] = [];
  for (const s of d.slides ?? []) {
    for (const el of s.pageElements ?? []) out.push(elementText(el));
    for (const el of s.slideProperties?.notesPage?.pageElements ?? []) out.push(elementText(el));
  }
  return out;
}

function countMatches(texts: string[], needle: string, matchCase: boolean): number {
  const n = matchCase ? needle : needle.toLowerCase();
  let count = 0;
  for (const t of texts) {
    const hay = matchCase ? t : t.toLowerCase();
    for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + n.length)) count += 1;
  }
  return count;
}

// ───────────── requests ─────────────

const getDeck = (call: Call, id: string) => call.api.request<Presentation>("GET", `/presentations/${enc(id)}`);

/** Guarded `batchUpdate`: a 400 `FAILED_PRECONDITION` is the stale-revision answer (C15). */
async function batchUpdate(call: Call, id: string, requests: unknown[], revisionId: string): Promise<BatchReply> {
  try {
    return await call.api.request<BatchReply>("POST", `/presentations/${enc(id)}:batchUpdate`, {
      body: { requests, writeControl: { requiredRevisionId: revisionId } },
    });
  } catch (e) {
    if (e instanceof GoogleToolError && e.status === 400 && e.reason === "FAILED_PRECONDITION") {
      throw new GoogleToolError("revision_changed", "revision_changed: the presentation changed since that revision; read it again with gslides_get and retry. Nothing was changed.", {
        status: 400,
        reason: e.reason,
      });
    }
    throw e;
  }
}

interface Current {
  title: string;
  revisionId: string;
  texts: string[];
}
const current = (d: Presentation): Current => ({ title: d.title ?? "(untitled)", revisionId: d.revisionId ?? "", texts: allTexts(d) });
const deckLine = (id: string, c: Current) => `Presentation: ${clip(c.title, 200)} (${id})`;

const REF_PROP = { type: "string", minLength: 1, description: "Presentation id or its docs.google.com/presentation URL." };
const REV_PROP = {
  type: "string",
  description: "Revision id from gslides_get. The edit fails with revision_changed if the deck changed since. Omitted: the current revision is used.",
};

export const gslides: ProductTools = {
  product: "slides",
  create(rt) {
    return [
      rt.define<{ id: string; offset: number }>({
        name: "gslides_get",
        label: "read presentation",
        description:
          `Read a Google Slides presentation (requires Slides level read): title, revisionId and, per slide, its id, the text of each shape (tables as "a | b" rows) and the speaker notes. Long decks come in pages of about ${TEXT_PAGE_CHARS} characters; pass offset=nextOffset (a slide index) for the next page.`,
        properties: { presentationId: REF_PROP, offset: { type: "integer", minimum: 0, description: "Slide index to continue from (nextOffset of the previous page)." } },
        required: ["presentationId"],
        level: "read",
        parse: (p) => ({ id: presentationRef(p), offset: optInt(p, "offset", { min: 0 }) ?? 0 }),
        async run(a, call): Promise<ToolOutput> {
          const d = await getDeck(call, a.id);
          const all = d.slides ?? [];
          const page: ReturnType<typeof outline>[] = [];
          let chars = 0;
          let next = a.offset;
          for (; next < all.length; next++) {
            const o = outline(all[next] as GSlide);
            const size = JSON.stringify(o).length;
            if (page.length > 0 && chars + size > TEXT_PAGE_CHARS) break;
            page.push(o);
            chars += size;
          }
          return {
            json: {
              presentationId: d.presentationId ?? a.id,
              title: d.title,
              revisionId: d.revisionId,
              slideCount: all.length,
              slides: page,
              ...(next < all.length ? { nextOffset: next } : {}),
            },
          };
        },
      }),

      rt.define<{ title: string }>({
        name: "gslides_create",
        label: "create presentation",
        description: "Create an empty Google Slides presentation (requires Slides level write; the user confirms first).",
        properties: { title: { type: "string", minLength: 1, maxLength: 1000 } },
        required: ["title"],
        level: "write",
        write: true,
        parse: (p) => ({ title: reqStr(p, "title", 1000) }),
        summary: (a) => [`Title: ${clip(a.title, 200)}`],
        async run(a, call): Promise<ToolOutput> {
          const d = await call.api.request<Presentation>("POST", "/presentations", { body: { title: a.title } });
          return {
            json: {
              created: true,
              presentationId: d.presentationId,
              title: d.title ?? a.title,
              revisionId: d.revisionId,
              url: d.presentationId ? `https://docs.google.com/presentation/d/${d.presentationId}/edit` : undefined,
            },
          };
        },
      }),

      rt.define<{ id: string; layout: Layout; title?: string; body?: string; revisionId?: string }, Current>({
        name: "gslides_add_slide",
        label: "add slide",
        description: `Append a slide to a presentation (requires Slides level write; the user confirms first). layout is one of: ${LAYOUT_NAMES.join(", ")}. title and body fill the layout's placeholders (BLANK takes no text; TITLE_ONLY, SECTION_HEADER, MAIN_POINT and BIG_NUMBER take a title only); any other layout needs at least one of them.`,
        properties: {
          presentationId: REF_PROP,
          layout: { type: "string", enum: LAYOUT_NAMES, description: "Google predefined layout." },
          title: { type: "string", maxLength: TITLE_MAX },
          body: { type: "string", maxLength: BODY_MAX },
          revisionId: REV_PROP,
        },
        required: ["presentationId", "layout"],
        level: "write",
        write: true,
        parse(p) {
          const layout = layoutArg(p);
          const slots: { title?: string; body?: string } = LAYOUTS[layout];
          const title = textArg(p, "title", TITLE_MAX);
          const body = textArg(p, "body", BODY_MAX);
          if (title !== undefined && !slots.title) throw invalidParams(`layout ${layout} has no title placeholder`);
          if (body !== undefined && !slots.body) throw invalidParams(`layout ${layout} has no body placeholder`);
          if (layout !== "BLANK" && title === undefined && body === undefined) throw invalidParams(`layout ${layout} needs a non-empty \`title\` or \`body\` (use BLANK for an empty slide)`);
          return { id: presentationRef(p), layout, title, body, revisionId: revisionArg(p) };
        },
        async prepare(a, call) {
          return current(await getDeck(call, a.id));
        },
        summary: (a, cur) => [
          deckLine(a.id, cur),
          `Layout: ${a.layout}`,
          ...(a.title !== undefined ? [`Title: ${clip(a.title, 200)}`] : []),
          ...(a.body !== undefined ? [`Body: ${clip(a.body)}`] : []),
          `Revision: ${a.revisionId ?? cur.revisionId}`,
        ],
        async run(a, call, cur): Promise<ToolOutput> {
          const key = randomUUID().replace(/-/g, "");
          const slideId = `gc_s_${key}`;
          const slots: { title?: string; body?: string } = LAYOUTS[a.layout];
          const parts = [
            ...(a.title !== undefined && slots.title ? [{ type: slots.title, text: a.title, objectId: `gc_t_${key}` }] : []),
            ...(a.body !== undefined && slots.body ? [{ type: slots.body, text: a.body, objectId: `gc_b_${key}` }] : []),
          ];
          const requests = [
            {
              createSlide: {
                objectId: slideId,
                slideLayoutReference: { predefinedLayout: a.layout },
                ...(parts.length ? { placeholderIdMappings: parts.map((x) => ({ layoutPlaceholder: { type: x.type, index: 0 }, objectId: x.objectId })) } : {}),
              },
            },
            ...parts.map((x) => ({ insertText: { objectId: x.objectId, text: x.text } })),
          ];
          const r = await batchUpdate(call, a.id, requests, a.revisionId ?? cur.revisionId);
          return { json: { added: true, slideId, layout: a.layout, revisionId: r.writeControl?.requiredRevisionId } };
        },
      }),

      rt.define<{ id: string; find: string; replace: string; matchCase: boolean; revisionId?: string }, Current & { count: number }>({
        name: "gslides_replace_text",
        label: "replace text",
        description:
          "Replace all matches of a text in a presentation (requires Slides level write; the user confirms first, seeing the match count). No match → nothing is changed and status no_match is returned.",
        properties: {
          presentationId: REF_PROP,
          find: { type: "string", minLength: 1, maxLength: FIND_MAX },
          replace: { type: "string", maxLength: BODY_MAX, description: 'Replacement ("" deletes the matches).' },
          matchCase: { type: "boolean", description: "Default true." },
          revisionId: REV_PROP,
        },
        required: ["presentationId", "find", "replace"],
        level: "write",
        write: true,
        parse(p) {
          if (typeof p.replace !== "string") throw invalidParams("`replace` is required (a string, may be empty)");
          if (p.replace.length > BODY_MAX) throw invalidParams(`\`replace\` is longer than ${BODY_MAX} characters`);
          return {
            id: presentationRef(p),
            find: reqStr(p, "find", FIND_MAX),
            replace: p.replace,
            matchCase: optBool(p, "matchCase") ?? true,
            revisionId: revisionArg(p),
          };
        },
        async prepare(a, call) {
          const cur = current(await getDeck(call, a.id));
          const count = countMatches(cur.texts, a.find, a.matchCase);
          if (count === 0) return new Skip({ json: { status: "no_match", replaced: 0, find: a.find } });
          return { ...cur, count };
        },
        summary: (a, cur) => [
          deckLine(a.id, cur),
          `Replace: "${clip(a.find, 200)}" \u2192 "${clip(a.replace, 200)}"`,
          `Matches: ${cur.count} match${cur.count === 1 ? "" : "es"} (${a.matchCase ? "case-sensitive" : "ignoring case"})`,
          `Revision: ${a.revisionId ?? cur.revisionId}`,
        ],
        async run(a, call, cur): Promise<ToolOutput> {
          const request = { replaceAllText: { containsText: { text: a.find, matchCase: a.matchCase }, replaceText: a.replace } };
          const r = await batchUpdate(call, a.id, [request], a.revisionId ?? cur.revisionId);
          return { json: { replaced: r.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0, revisionId: r.writeControl?.requiredRevisionId } };
        },
      }),
    ];
  },
};
