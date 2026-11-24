/**
 * Google Docs tools (`gdocs_*`, design D11; spec google-docs-tools). `gdocs_get` (level read) returns the body as
 * Markdown (`#` headings, `-`/`1.` lists, pipe tables; scenario-gate C13) in 20 000-char pages. `gdocs_create`,
 * `gdocs_append_text` and `gdocs_replace_text` (level write) are confirmed first and never clobber concurrent
 * edits: every batchUpdate carries `writeControl.requiredRevisionId` — the caller's `revisionId`, else the revision
 * read for the confirm dialog (C16) — and Google's 400 `FAILED_PRECONDITION` becomes `revision_changed` (C15).
 * A replace with 0 matches is never confirmed (C14). See change: add-google-connect.
 */

import { pageText } from "../paging.js";
import { optBool, optInt, type Params, reqStr } from "../params.js";
import { clip } from "../preview.js";
import { type Call, type ProductTools, Skip, type ToolOutput } from "../runtime.js";
import { GoogleToolError, invalidParams } from "../tool-error.js";

const enc = encodeURIComponent;
const DOC_ID = /^[A-Za-z0-9_-]{1,256}$/;
const DOC_URL = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,256})(?:[/?#]|$)/;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_MATCH = 1000;
const MAX_REVISION_ID = 256;
const urlOf = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

interface Para {
  elements?: Array<{ textRun?: { content?: string } }>;
  paragraphStyle?: { namedStyleType?: string };
  bullet?: { listId?: string; nestingLevel?: number };
}
interface Element {
  paragraph?: Para;
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: Element[] }> }> };
  endIndex?: number;
}
interface GDoc {
  documentId?: string;
  title?: string;
  revisionId?: string;
  body?: { content?: Element[] };
  lists?: Record<string, { listProperties?: { nestingLevels?: Array<{ glyphType?: string }> } }>;
}
interface BatchReply {
  replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }>;
  writeControl?: { requiredRevisionId?: string };
}

// ───────────── argument parsing ─────────────

/** A document id or a `docs.google.com/document/d/<id>/…` URL → the id. */
function docId(p: Params): string {
  const v = reqStr(p, "document", 2048).trim();
  const id = DOC_URL.exec(v)?.[1] ?? (DOC_ID.test(v) ? v : undefined);
  if (!id) throw invalidParams("`document` must be a Google Docs document id or a docs.google.com/document/d/<id> URL");
  return id;
}

/** A string that may contain any characters, whitespace and (when `allowEmpty`) nothing at all. */
function text(p: Params, name: string, max: number, allowEmpty = false): string {
  const v = p[name];
  if (typeof v !== "string" || (!allowEmpty && v.length === 0)) throw invalidParams(`\`${name}\` is required (${allowEmpty ? "string" : "non-empty string"})`);
  if (v.length > max) throw invalidParams(`\`${name}\` is longer than ${max} characters`);
  return v;
}

/** `revisionId`: absent → guard with the revision read for the dialog; present → a non-empty string. */
function revisionArg(p: Params): string | undefined {
  const v = p.revisionId;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_REVISION_ID) throw invalidParams("`revisionId` must be the non-empty revision id returned by gdocs_get");
  return v;
}

// ───────────── Docs body → Markdown / plain text ─────────────

const paraText = (p: Para): string => (p.elements ?? []).map((e) => e.textRun?.content ?? "").join("");

/** Every paragraph of the body, table cells included, in document order (the unit Google matches within). */
function paragraphs(content: Element[] | undefined): string[] {
  const out: string[] = [];
  for (const el of content ?? []) {
    if (el.paragraph) out.push(paraText(el.paragraph));
    for (const row of el.table?.tableRows ?? []) for (const cell of row.tableCells ?? []) out.push(...paragraphs(cell.content));
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\u000b|\n/g, " ").trim();
const cell = (c: { content?: Element[] }) => paragraphs(c.content).map(oneLine).filter(Boolean).join(" ").replace(/\|/g, "\\|");

function markdown(doc: GDoc): string {
  const lines: string[] = [];
  for (const el of doc.body?.content ?? []) {
    const p = el.paragraph;
    if (p) {
      const t = paraText(p).replace(/\n$/, "").replace(/\u000b/g, "\n");
      const style = p.paragraphStyle?.namedStyleType ?? "";
      const heading = /^HEADING_([1-6])$/.exec(style);
      if (p.bullet) {
        const level = Math.max(0, p.bullet.nestingLevel ?? 0);
        const glyph = doc.lists?.[p.bullet.listId ?? ""]?.listProperties?.nestingLevels?.[level]?.glyphType;
        lines.push(`${"  ".repeat(level)}${glyph && glyph !== "GLYPH_TYPE_UNSPECIFIED" ? "1." : "-"} ${t}`);
      } else if (heading) lines.push(`${"#".repeat(Number(heading[1]))} ${t}`);
      else if (style === "TITLE") lines.push(`# ${t}`);
      else lines.push(t);
    }
    const rows = el.table?.tableRows;
    if (rows?.length) {
      rows.forEach((row, i) => {
        const cells = row.tableCells ?? [];
        lines.push(`| ${cells.map(cell).join(" | ")} |`);
        if (i === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
      });
    }
  }
  return lines.join("\n").replace(/\n+$/, "");
}

/** One page, never cut inside a surrogate pair (the pair moves whole to the next page). */
function page(body: string, offset: number | undefined) {
  const first = pageText(body, offset);
  if (first.nextOffset === undefined || !/[\uD800-\uDBFF]$/.test(first.text)) return first;
  return pageText(body, offset, first.text.length - 1);
}

/** Matches of `needle` in the paragraphs, non-overlapping, as Google's `replaceAllText` counts them. */
function countMatches(paras: string[], needle: string, matchCase: boolean): number {
  const n = matchCase ? needle : needle.toLowerCase();
  return paras.reduce((sum, t) => sum + ((matchCase ? t : t.toLowerCase()).split(n).length - 1), 0);
}

// ───────────── calls ─────────────

const getDoc = (call: Call, id: string) =>
  call.api.request<GDoc>("GET", `/documents/${enc(id)}`, { query: { fields: "documentId,title,revisionId,body,lists" } });

interface Prepared {
  id: string;
  title: string;
  /** The revision the write is guarded with: the caller's, else the one read now. */
  guard: string;
  /** Index to insert at the end of the body (before the final newline). */
  end: number;
  paras: string[];
  matches: number;
}

async function readForWrite(call: Call, id: string, revisionId: string | undefined, match?: { text: string; matchCase: boolean }): Promise<Prepared> {
  const doc = await getDoc(call, id);
  const content = doc.body?.content ?? [];
  const paras = paragraphs(content);
  const last = content[content.length - 1]?.endIndex ?? 2;
  return {
    id,
    title: doc.title ?? "(untitled)",
    guard: revisionId ?? doc.revisionId ?? "",
    end: Math.max(1, last - 1),
    paras,
    matches: match ? countMatches(paras, match.text, match.matchCase) : 0,
  };
}

/** A guarded batchUpdate. Google's 400 `FAILED_PRECONDITION` (the doc moved past `guard`) → `revision_changed`. */
async function batchUpdate(call: Call, st: Prepared, requests: unknown[]): Promise<BatchReply> {
  try {
    return await call.api.request<BatchReply>("POST", `/documents/${enc(st.id)}:batchUpdate`, {
      body: { requests, ...(st.guard ? { writeControl: { requiredRevisionId: st.guard } } : {}) },
    });
  } catch (e) {
    if (e instanceof GoogleToolError && e.status === 400 && e.reason === "FAILED_PRECONDITION") {
      throw new GoogleToolError("revision_changed", `the document changed since revision ${clip(st.guard, 80)}; nothing was changed. Read it again with gdocs_get and retry`, { status: 400, reason: e.reason });
    }
    throw e;
  }
}

/** The revision after a write: Google echoes it in `writeControl`; otherwise read it. */
async function newRevision(call: Call, id: string, reply: BatchReply): Promise<string | undefined> {
  return reply.writeControl?.requiredRevisionId ?? (await getDoc(call, id)).revisionId;
}

const docLines = (st: Prepared) => [`Document: ${clip(st.title, 200)} [${clip(st.id, 120)}]`];
const guardLine = (a: { revisionId?: string }) => (a.revisionId ? `Guarded by revision ${clip(a.revisionId, 80)}` : "Guarded by the revision read for this confirmation");

const DOC_PROP = { type: "string", minLength: 1, description: "Document id or docs.google.com/document/d/<id> URL." };
const REV_PROP = {
  type: "string",
  minLength: 1,
  description: "Revision id from gdocs_get. The edit fails with revision_changed if the document changed since. Omitted: guarded with the revision read when the confirmation is shown.",
};

export const gdocs: ProductTools = {
  product: "docs",
  create(rt) {
    return [
      rt.define({
        name: "gdocs_get",
        label: "read document",
        description:
          "Read a Google Doc as Markdown (# headings, - / 1. lists, | tables |), with its title and revision id. Long documents come in pages: pass the returned nextOffset as offset. Requires Docs level read.",
        properties: { document: DOC_PROP, offset: { type: "integer", minimum: 0, description: "Character offset to continue from (nextOffset of the previous page)." } },
        required: ["document"],
        level: "read",
        parse: (p) => ({ id: docId(p), offset: optInt(p, "offset") }),
        async run(a, call): Promise<ToolOutput> {
          const doc = await getDoc(call, a.id);
          const pg = page(markdown(doc), a.offset);
          return { json: { documentId: doc.documentId ?? a.id, title: doc.title, revisionId: doc.revisionId, url: urlOf(a.id), ...pg } };
        },
      }),

      rt.define({
        name: "gdocs_create",
        label: "create document",
        description: "Create a Google Doc with a title and optional initial text (requires Docs level write; the user confirms first).",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 1024 },
          text: { type: "string", description: "Optional initial body text." },
        },
        required: ["title"],
        level: "write",
        write: true,
        parse: (p) => ({ title: reqStr(p, "title", 1024), text: p.text === undefined || p.text === null || p.text === "" ? undefined : text(p, "text", MAX_TEXT) }),
        summary: (a) => [`Title: ${clip(a.title, 200)}`, a.text === undefined ? "Text: (none)" : `Text: ${clip(a.text)}`],
        async run(a, call): Promise<ToolOutput> {
          const doc = await call.api.request<GDoc>("POST", "/documents", { body: { title: a.title } });
          const id = doc.documentId ?? "";
          let revisionId = doc.revisionId;
          if (a.text !== undefined) {
            try {
              const r = await call.api.request<BatchReply>("POST", `/documents/${enc(id)}:batchUpdate`, {
                body: { requests: [{ insertText: { location: { index: 1 }, text: a.text } }] },
              });
              revisionId = (await newRevision(call, id, r)) ?? revisionId;
            } catch (e) {
              if (!(e instanceof GoogleToolError)) throw e;
              throw new GoogleToolError(e.code, `${e.message}; the document ${id} was created but its initial text was not inserted`, {
                ...(e.status !== undefined ? { status: e.status } : {}),
                ...(e.reason ? { reason: e.reason } : {}),
              });
            }
          }
          return { json: { created: true, documentId: id, title: doc.title ?? a.title, revisionId, url: urlOf(id) } };
        },
      }),

      rt.define({
        name: "gdocs_append_text",
        label: "append text",
        description:
          "Append text to the end of a Google Doc (requires Docs level write; the user confirms first). Pass the revisionId from gdocs_get so the edit fails with revision_changed instead of overwriting someone else's change.",
        properties: { document: DOC_PROP, text: { type: "string", minLength: 1, description: "Text to insert at the end, exactly as given." }, revisionId: REV_PROP },
        required: ["document", "text"],
        level: "write",
        write: true,
        parse: (p) => ({ id: docId(p), text: text(p, "text", MAX_TEXT), revisionId: revisionArg(p) }),
        prepare: (a, call) => readForWrite(call, a.id, a.revisionId),
        summary: (a, st) => [...docLines(st), `Append at the end: ${clip(a.text)}`, guardLine(a)],
        async run(a, call, st): Promise<ToolOutput> {
          const r = await batchUpdate(call, st, [{ insertText: { location: { index: st.end }, text: a.text } }]);
          return { json: { appended: true, documentId: st.id, title: st.title, revisionId: await newRevision(call, st.id, r), url: urlOf(st.id) } };
        },
      }),

      rt.define({
        name: "gdocs_replace_text",
        label: "replace text",
        description:
          "Replace ALL occurrences of a literal text in a Google Doc (not a regex; matchCase default true). Requires Docs level write; the user confirms first, seeing the match count. No match → nothing is asked or changed (code no_match, count 0). Pass the revisionId from gdocs_get to avoid overwriting concurrent edits.",
        properties: {
          document: DOC_PROP,
          match: { type: "string", minLength: 1, description: "Literal text to find." },
          replacement: { type: "string", description: "Replacement text (may be empty to delete the matches)." },
          matchCase: { type: "boolean", description: "Case-sensitive match. Default true." },
          revisionId: REV_PROP,
        },
        required: ["document", "match", "replacement"],
        level: "write",
        write: true,
        parse: (p) => ({
          id: docId(p),
          match: text(p, "match", MAX_MATCH),
          replacement: text(p, "replacement", MAX_TEXT, true),
          matchCase: optBool(p, "matchCase") ?? true,
          revisionId: revisionArg(p),
        }),
        async prepare(a, call) {
          const st = await readForWrite(call, a.id, a.revisionId, { text: a.match, matchCase: a.matchCase });
          if (st.matches === 0) return new Skip({ json: { code: "no_match", count: 0, replaced: 0, documentId: st.id, title: st.title } });
          return st;
        },
        summary: (a, st) => [
          ...docLines(st),
          `Match: ${clip(a.match, 200)}${a.matchCase ? "" : " (ignoring case)"}`,
          `Replacement: ${a.replacement === "" ? "(delete)" : clip(a.replacement, 200)}`,
          `Matches: ${st.matches}`,
          guardLine(a),
        ],
        async run(a, call, st): Promise<ToolOutput> {
          const r = await batchUpdate(call, st, [{ replaceAllText: { containsText: { text: a.match, matchCase: a.matchCase }, replaceText: a.replacement } }]);
          const replaced = r.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
          return { json: { replaced, documentId: st.id, title: st.title, revisionId: await newRevision(call, st.id, r), url: urlOf(st.id) } };
        },
      }),
    ];
  },
};
