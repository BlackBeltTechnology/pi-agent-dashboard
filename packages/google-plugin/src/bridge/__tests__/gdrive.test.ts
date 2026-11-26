/**
 * L1 Drive tools (test-plan #C40, #C43–#C69; tasks 12.40, 12.43–12.68) against the REAL lease handler and a fake
 * Google Drive: search/get/pick, download/export into the workspace, and the four confirmed writes.
 * `gdrive_pick` runs against the real UI-side hook (`client/picker.ts`) with a token route that answers like the
 * server's (local browser + built-in account). See change: add-google-connect.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerPickerPrompt } from "../../client/picker.js";
import type { PickedFile } from "../../shared/picker.js";
import type { ToolContext } from "../runtime.js";
import { createFakeGoogle, type FakeGoogle, type FakeRequest, googleError, jsonOf, makeToolHost, NO_UI, uiCtx } from "./fake-google.js";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const SLIDES = "application/vnd.google-apps.presentation";
const FOLDER = "application/vnd.google-apps.folder";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const WORK = { sub: "s1", email: "a@x.com", alias: "work", products: { drive: "write" } } as const;
const FILES = { sub: "s2", email: "f@x.com", alias: "files", products: { drive: "files" } } as const;

interface DFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  bytes?: Buffer;
}
const file = (id: string, name: string, mimeType: string, over: Partial<DFile> = {}): DFile => ({
  id,
  name,
  mimeType,
  parents: ["root1"],
  modifiedTime: "2026-05-01T10:00:00.000Z",
  webViewLink: `https://drive.google.com/file/d/${id}/view`,
  ...over,
});
const view = ({ bytes: _b, ...f }: DFile) => f;
const idOf = (req: FakeRequest) => decodeURIComponent(req.path.split("/")[2] ?? "");

/** A tiny stateful Drive behind the fake: metadata, media, export, PATCH (move/trash), folder create, multipart upload. */
function fakeDrive(google: FakeGoogle, initial: DFile[], opts: { exports?: Record<string, Buffer> } = {}) {
  const byId = new Map(initial.map((f) => [f.id, { ...f }]));
  const missing = () => googleError(404, "notFound", undefined, "File not found");
  google
    .on("GET", /^\/files\/[^/]+$/, (req) => {
      const f = byId.get(idOf(req));
      if (!f) return missing();
      return req.query.alt === "media" ? { bytes: f.bytes ?? Buffer.alloc(0) } : { json: view(f) };
    })
    .on("GET", /^\/files\/[^/]+\/export$/, (req) => {
      const f = byId.get(idOf(req));
      return f ? { bytes: opts.exports?.[req.query.mimeType ?? ""] ?? Buffer.from("exported") } : missing();
    })
    .on("PATCH", /^\/files\/[^/]+$/, (req) => {
      const f = byId.get(idOf(req));
      if (!f) return missing();
      const rm = (req.query.removeParents ?? "").split(",").filter(Boolean);
      if (req.query.addParents || rm.length) f.parents = [...(f.parents ?? []).filter((p) => !rm.includes(p)), ...(req.query.addParents ? [req.query.addParents] : [])];
      if ((req.body as { trashed?: boolean } | undefined)?.trashed) byId.delete(f.id);
      return { json: view(f) };
    })
    .on("POST", "/files", (req) => {
      const b = req.body as { name: string; mimeType: string; parents?: string[] };
      const f = file(`new${byId.size + 1}`, b.name, b.mimeType, { parents: b.parents });
      byId.set(f.id, f);
      return { json: view(f) };
    })
    .on("POST", "/upload/drive/v3/files", (req) => {
      const { meta } = multipart(req);
      const f = file(`up${byId.size + 1}`, meta.name as string, (meta.mimeType as string | undefined) ?? "application/octet-stream", { parents: meta.parents as string[] | undefined });
      byId.set(f.id, f);
      return { json: view(f) };
    });
  return byId;
}

/** Split a multipart/related upload body into its JSON metadata and the exact content bytes. */
function multipart(req: FakeRequest): { meta: Record<string, unknown>; content: Buffer; contentType: string } {
  const boundary = /boundary=(.+)$/.exec(req.headers["content-type"] ?? "")?.[1] ?? "";
  const segs = (req.bodyBytes ?? Buffer.alloc(0)).toString("latin1").split(`--${boundary}`);
  const [, ...metaRest] = (segs[1] ?? "").split("\r\n\r\n");
  const [partHead = "", ...contentRest] = (segs[2] ?? "").split("\r\n\r\n");
  return {
    meta: JSON.parse(metaRest.join("\r\n\r\n").replace(/\r\n$/, "")),
    content: Buffer.from(contentRest.join("\r\n\r\n").replace(/\r\n$/, ""), "latin1"),
    contentType: /Content-Type: (.+)/.exec(partHead)?.[1]?.trim() ?? "",
  };
}

let cwd: string;
let outside: string;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "gdrive-cwd-"));
  outside = mkdtempSync(path.join(tmpdir(), "gdrive-out-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.useRealTimers();
});

const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
/** A confirming (or denying) UI whose cwd is the temp workspace. */
function ui(answer: boolean | "never" = true, dir: () => string = () => cwd) {
  const c = uiCtx(answer);
  return { confirm: c.confirm, get ctx(): ToolContext { return { ...c.ctx, cwd: dir() }; } };
}
const inCwd = (): ToolContext => ({ hasUI: false, cwd });
const confirmText = (c: { confirm: ReturnType<typeof uiCtx>["confirm"] }) => (c.confirm.mock.calls[0] as [string, string]).slice(0, 2).join("\n");

function host(files: DFile[] = [], accounts: Array<Record<string, unknown>> = [WORK], opts: { exports?: Record<string, Buffer> } = {}) {
  const google = createFakeGoogle();
  const drive = fakeDrive(google, files, opts);
  const h = makeToolHost({ accounts: accounts as never, google });
  return { ...h, drive };
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ───────────────────────────── levels, search, get ─────────────────────────────

describe("Drive levels (files level sees only app files)", () => {
  it("#C40 files level: an existing doc is invisible → empty list + a note that `files` only sees picked/app-created files", async () => {
    const h = host([], [FILES]);
    h.google.on("GET", "/files", { json: { files: [] } });
    const r = jsonOf<{ files: unknown[]; note?: string }>(await h.run("gdrive_search", { account: "files", text: "Budget" }));
    expect(r.files).toEqual([]);
    expect(r.note).toMatch(/files/);
    expect(r.note).toMatch(/picked|created/);
  });

  it("#C43 files level: an app-created file is found; `gdrive_get` on a non-picked id → drive_error 404 with the `files`-limit note", async () => {
    const h = host([file("mine", "Created by app", DOC)], [FILES]);
    h.google.on("GET", "/files", { json: { files: [file("mine", "Created by app", DOC)] } });
    const found = jsonOf<{ files: Array<{ id: string }> }>(await h.run("gdrive_search", { account: "files" }));
    expect(found.files.map((f) => f.id)).toEqual(["mine"]);
    const e = await err(h.run("gdrive_get", { account: "files", fileId: "someone-elses" }));
    expect(e).toMatchObject({ code: "drive_error", status: 404 });
    expect(e?.message).toMatch(/level "files"/);
    expect(e?.message).toMatch(/gdrive_pick/);
  });

  it("a higher level has no `files` note", async () => {
    const h = host([], [WORK]);
    h.google.on("GET", "/files", { json: { files: [] } });
    expect(jsonOf<{ note?: string }>(await h.run("gdrive_search", { account: "work" })).note).toBeUndefined();
  });
});

describe("read tools", () => {
  const three = [file("d1", "Plan", DOC, { parents: ["F1"] }), file("F1", "Projects", FOLDER, { parents: ["root1"] }), file("p1", "scan.pdf", "application/pdf", { parents: ["F1"] })];

  it("#C50 gdrive_search: each filter builds the right q; rows carry id, name, type, parent, modifiedTime, webViewLink", async () => {
    const h = host(three);
    h.google.on("GET", "/files", { json: { files: three.map(view) } });
    const r = jsonOf<{ files: Array<Record<string, unknown>> }>(await h.run("gdrive_search", { account: "work" }));
    expect(r.files[0]).toEqual({ id: "d1", name: "Plan", type: "document", parent: "F1", modifiedTime: "2026-05-01T10:00:00.000Z", webViewLink: "https://drive.google.com/file/d/d1/view" });
    expect(r.files.map((f) => f.type)).toEqual(["document", "folder", "pdf"]);
    const q = async (params: Record<string, unknown>) => {
      await h.run("gdrive_search", { account: "work", ...params });
      return (h.google.to("GET", "/files").at(-1) as FakeRequest).query.q;
    };
    expect(await q({})).toBe("trashed = false");
    expect(await q({ text: "budget" })).toBe("trashed = false and fullText contains 'budget'");
    expect(await q({ name: "Plan" })).toBe("trashed = false and name contains 'Plan'");
    expect(await q({ type: "spreadsheet" })).toBe(`trashed = false and mimeType = '${SHEET}'`);
    expect(await q({ type: "pdf" })).toBe("trashed = false and mimeType = 'application/pdf'");
    expect(await q({ folderId: "F1" })).toBe("trashed = false and 'F1' in parents");
    expect(await q({ text: "x", name: "y", type: "folder", folderId: "F1" })).toBe(`trashed = false and fullText contains 'x' and name contains 'y' and mimeType = '${FOLDER}' and 'F1' in parents`);
  });

  it("#C50 an unknown type is an argument error before any HTTP call", async () => {
    const h = host(three);
    expect(await err(h.run("gdrive_search", { account: "work", type: "spreadsheat" }))).toMatchObject({ code: "invalid_params" });
    expect(h.google.calls).toHaveLength(0);
  });

  it("#C51 quotes and backslashes are escaped; the q is sent verbatim (no `' or trashed=true or '` injection)", async () => {
    const h = host();
    h.google.on("GET", "/files", { json: { files: [] } });
    await h.run("gdrive_search", { account: "work", text: `it's a \\ "x"`, name: "' or trashed=true or '", folderId: "a' or trashed=true or 'b" });
    expect((h.google.calls[0] as FakeRequest).query.q).toBe(
      `trashed = false and fullText contains 'it\\'s a \\\\ "x"' and name contains '\\' or trashed=true or \\'' and 'a\\' or trashed=true or \\'b' in parents`,
    );
  });

  it("#C52 0, 1 and pageSize+1 results: empty is ok; the paging token is returned only when Google has more; pageToken is forwarded", async () => {
    const h = host();
    const all = Array.from({ length: 3 }, (_, i) => view(file(`f${i}`, `n${i}`, DOC)));
    h.google.on("GET", "/files", (req) => {
      const size = Number(req.query.pageSize);
      const start = req.query.pageToken ? Number(req.query.pageToken) : 0;
      const slice = all.slice(start, start + size);
      return { json: { files: slice, ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) } };
    });
    expect(jsonOf(await h.run("gdrive_search", { account: "work", pageSize: 5 }))).toMatchObject({ files: expect.any(Array) });
    const none = host();
    none.google.on("GET", "/files", { json: {} });
    expect(jsonOf(await none.run("gdrive_search", { account: "work" }))).toEqual({ files: [] });
    const one = jsonOf<{ files: unknown[]; nextPageToken?: string }>(await h.run("gdrive_search", { account: "work", pageSize: 3 }));
    expect(one.files).toHaveLength(3);
    expect(one.nextPageToken).toBeUndefined();
    const first = jsonOf<{ files: unknown[]; nextPageToken?: string }>(await h.run("gdrive_search", { account: "work", pageSize: 2 }));
    expect(first.files).toHaveLength(2);
    expect(first.nextPageToken).toBe("2");
    const second = jsonOf<{ files: unknown[]; nextPageToken?: string }>(await h.run("gdrive_search", { account: "work", pageSize: 2, pageToken: "2" }));
    expect(second.files).toHaveLength(1);
    expect(second.nextPageToken).toBeUndefined();
  });

  it("gdrive_get returns the metadata fields", async () => {
    const h = host(three);
    expect(jsonOf(await h.run("gdrive_get", { account: "work", fileId: "p1" }))).toMatchObject({ id: "p1", name: "scan.pdf", type: "pdf", parent: "F1", mimeType: "application/pdf" });
  });
});

// ───────────────────────────── picking ─────────────────────────────

describe("gdrive_pick", () => {
  const budget: PickedFile = { id: "sheet1", name: "Budget 2026", mimeType: SHEET };

  /** The dashboard tab: the real UI hook with a token route that answers like the server (local browser + built-in account). */
  function tab(o: { client: "builtin" | "own"; local: boolean; pick?: PickedFile[]; onGrant?: (f: PickedFile[]) => void }) {
    const show = vi.fn(async () => {
      o.onGrant?.(o.pick ?? []);
      return o.pick ?? [];
    });
    const token = vi.fn(async () => {
      if (o.client !== "builtin" || !o.local) throw Object.assign(new Error("picker_unavailable"), { code: "picker_unavailable", status: 403 });
      return { accessToken: "PICKER-TOKEN", expiresAt: 1 };
    });
    const input = vi.fn((_t: string, _p?: string, opts?: unknown) => answerPickerPrompt((opts as { pluginMeta?: Record<string, unknown> }).pluginMeta, { show }, token));
    return { show, token, input, ctx: { hasUI: true, cwd, ui: { confirm: vi.fn(async () => true), input } } as ToolContext };
  }

  it("#C44 only (built-in, local browser) opens the picker; own client or remote browser → picker_unavailable, picker never shown, nothing readable", async () => {
    for (const [client, local, opens] of [["builtin", true, true], ["builtin", false, false], ["own", true, false], ["own", false, false]] as const) {
      const h = host([], [FILES]);
      const t = tab({ client, local, pick: [budget] });
      const run = h.run("gdrive_pick", { account: "files" }, t.ctx);
      if (opens) {
        expect(jsonOf<{ files: unknown[] }>(await run).files).toHaveLength(1);
        expect(t.show).toHaveBeenCalledWith("PICKER-TOKEN");
      } else {
        const e = await err(run);
        expect(e, `${client}/${local ? "local" : "remote"}`).toMatchObject({ code: "picker_unavailable" });
        expect(e?.message).toMatch(/built-in/);
        expect(t.show).not.toHaveBeenCalled();
      }
    }
  });

  it("#C44 the prompt names the account and the plugin kind; no UI or no text prompt → picker_unavailable without a prompt", async () => {
    const h = host([], [FILES]);
    const t = tab({ client: "builtin", local: true, pick: [] });
    await h.run("gdrive_pick", { account: "files" }, t.ctx);
    expect(t.input).toHaveBeenCalledTimes(1);
    expect(t.input.mock.calls[0]?.[2]).toMatchObject({ pluginMeta: { pluginId: "google", kind: "drive-picker", account: "s2", email: "f@x.com" } });
    expect(await err(h.run("gdrive_pick", { account: "files" }, NO_UI))).toMatchObject({ code: "picker_unavailable" });
    expect(await err(h.run("gdrive_pick", { account: "files" }, { hasUI: true, cwd, ui: { confirm: async () => true } }))).toMatchObject({ code: "picker_unavailable" });
  });

  it("#C44 (GAP C-G8 / scenario-gate C8) the tool is not level-gated: at read/write an own client is told picker_unavailable, not level_insufficient", async () => {
    const h = host([], [WORK]);
    const t = tab({ client: "own", local: true });
    expect(await err(h.run("gdrive_pick", { account: "work" }, t.ctx))).toMatchObject({ code: "picker_unavailable" });
  });

  it("#GC8 gdrive_pick works at every Drive level (files, read, write): never level-gated, returns the picked ids", async () => {
    for (const level of ["files", "read", "write"]) {
      const h = host([], [{ ...WORK, products: { drive: level } }]);
      const t = tab({ client: "builtin", local: true, pick: [budget] });
      expect(jsonOf<{ files: Array<{ id: string; name: string }> }>(await h.run("gdrive_pick", { account: "work" }, t.ctx)).files, level).toEqual([{ id: "sheet1", name: "Budget 2026", type: expect.any(String) }]);
      expect(h.leaseCalls()[0]?.payload, level).toEqual({ account: "s1", product: "drive", level: "files" });
    }
  });

  it("#C45 remote dashboard (forwarded request): picker_unavailable explains that only app-created files are visible at `files`", async () => {
    const h = host([], [FILES]);
    const e = await err(h.run("gdrive_pick", { account: "files" }, tab({ client: "builtin", local: false }).ctx));
    expect(e).toMatchObject({ code: "picker_unavailable" });
    expect(e?.message).toMatch(/only (files )?(created|app-created)/i);
    expect(e?.message).toMatch(/level "files"/);
  });

  it("#C46 the user picks a spreadsheet → {id,name,type}; gdrive_export of that id works, of an unpicked id fails", async () => {
    const h = host([], [FILES]);
    const granted = new Set<string>();
    h.google.on("GET", /^\/files\/[^/]+$/, (req) => (granted.has(idOf(req)) ? { json: view(file(idOf(req), "Budget 2026", SHEET)) } : googleError(404, "notFound", undefined, "File not found")));
    h.google.on("GET", /^\/files\/[^/]+\/export$/, (req) => (granted.has(idOf(req)) ? { bytes: Buffer.from("a,b") } : googleError(404, "notFound", undefined, "File not found")));
    const t = tab({ client: "builtin", local: true, pick: [budget], onGrant: (fs) => fs.forEach((f) => granted.add(f.id)) });
    const r = jsonOf<{ files: Array<Record<string, unknown>> }>(await h.run("gdrive_pick", { account: "files" }, t.ctx));
    expect(r.files).toEqual([{ id: "sheet1", name: "Budget 2026", type: "spreadsheet" }]);
    const ok = jsonOf<{ path: string; size: number }>(await h.run("gdrive_export", { account: "files", fileId: "sheet1", format: "csv", path: "budget.csv" }, inCwd()));
    expect(ok).toEqual({ path: "budget.csv", size: 3 });
    expect(readFileSync(path.join(cwd, "budget.csv"), "utf8")).toBe("a,b");
    expect(await err(h.run("gdrive_export", { account: "files", fileId: "other", format: "csv", path: "o.csv" }, inCwd()))).toMatchObject({ code: "drive_error", status: 404 });
    expect(existsSync(path.join(cwd, "o.csv"))).toBe(false);
  });

  it("#C47/#GC9 cancel / closed dialog / dismissed prompt → empty selection and no file becomes readable", async () => {
    const h = host([], [FILES]);
    h.google.on("GET", /^\/files\/[^/]+$/, googleError(404, "notFound", undefined, "File not found"));
    const mk = (input: () => Promise<string | undefined>): ToolContext => ({ hasUI: true, cwd, ui: { confirm: async () => true, input } });
    for (const input of [async () => undefined, async () => "", async () => JSON.stringify({ files: [] }), async () => "not json"]) {
      expect(jsonOf(await h.run("gdrive_pick", { account: "files" }, mk(input)))).toEqual({ files: [] });
    }
    expect(await err(h.run("gdrive_get", { account: "files", fileId: "sheet1" }))).toMatchObject({ code: "drive_error", status: 404 });
  });

  it("#C47/#GC9 nobody answers: after 5 minutes the tool returns an empty selection", async () => {
    vi.useFakeTimers();
    const h = host([], [FILES]);
    const ctx: ToolContext = { hasUI: true, cwd, ui: { confirm: async () => true, input: () => new Promise<string | undefined>(() => undefined) } };
    const run = h.run("gdrive_pick", { account: "files" }, ctx);
    await vi.advanceTimersByTimeAsync(299_000);
    let settled = false;
    void run.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(jsonOf(await run)).toEqual({ files: [] });
  });

  it("#C48/#GC9 picks are Google's: nothing is cached by the tool, so after disconnect + reconnect (fresh grant) an old picked id is 404 again", async () => {
    const h = host([], [FILES]);
    const granted = new Set<string>(["sheet1"]);
    h.google.on("GET", /^\/files\/[^/]+$/, (req) => (granted.has(idOf(req)) ? { json: view(file("sheet1", "Budget 2026", SHEET)) } : googleError(404, "notFound", undefined, "File not found")));
    expect(jsonOf(await h.run("gdrive_get", { account: "files", fileId: "sheet1" }))).toMatchObject({ id: "sheet1" });
    await h.disconnect("s2");
    expect(await err(h.run("gdrive_get", { account: "files", fileId: "sheet1" }))).toMatchObject({ code: "not_found" });
    granted.clear(); // the new grant starts without picks
    const again = host([], [FILES]);
    again.google.on("GET", /^\/files\/[^/]+$/, googleError(404, "notFound", undefined, "File not found"));
    const e = await err(again.run("gdrive_get", { account: "files", fileId: "sheet1" }));
    expect(e).toMatchObject({ code: "drive_error", status: 404 });
    expect(again.google.to("GET", /^\/files\//)).toHaveLength(1); // asked Google again, no local memory
  });
});

// ───────────────────────────── downloads / exports stay in the workspace ─────────────────────────────

describe("download and export", () => {
  const docs = [file("doc1", "Report", DOC), file("sh1", "Numbers", SHEET), file("sl1", "Deck", SLIDES), file("pdf1", "scan.pdf", "application/pdf")];

  it("#C53 export a Google Doc as docx → out/report.docx (dir created), {path,size:1234}, the docx MIME is sent to the export endpoint", async () => {
    const bytes = randomBytes(1234);
    const h = host(docs, [WORK], { exports: { [DOCX]: bytes } });
    const r = jsonOf<{ path: string; size: number }>(await h.run("gdrive_export", { account: "work", fileId: "doc1", format: "docx", path: "out/report.docx" }, inCwd()));
    expect(r).toEqual({ path: "out/report.docx", size: 1234 });
    expect(readFileSync(path.join(cwd, "out", "report.docx"))).toEqual(bytes);
    expect(h.google.to("GET", /export$/)[0]?.query.mimeType).toBe(DOCX);
  });

  it("#C54/#GC10 formats × sources: valid combinations send the right MIME; invalid ones fail with `unsupported_export` listing the valid formats, writing nothing", async () => {
    const h = host(docs);
    const valid: Array<[string, string, string]> = [
      ["doc1", "pdf", "application/pdf"], ["doc1", "docx", DOCX], ["doc1", "txt", "text/plain"],
      ["sh1", "pdf", "application/pdf"], ["sh1", "xlsx", XLSX], ["sh1", "csv", "text/csv"],
      ["sl1", "pdf", "application/pdf"], ["sl1", "pptx", PPTX], ["sl1", "txt", "text/plain"],
    ];
    for (const [id, format, mime] of valid) {
      await h.run("gdrive_export", { account: "work", fileId: id, format, path: `ok/${id}.${format}` }, inCwd());
      expect((h.google.to("GET", /export$/).at(-1) as FakeRequest).query.mimeType, `${id} ${format}`).toBe(mime);
    }
    const before = readdirSync(path.join(cwd, "ok")).length;
    for (const [id, format, valids] of [["doc1", "xlsx", "pdf, docx, txt"], ["sh1", "pptx", "pdf, xlsx, csv"], ["sl1", "csv", "pdf, pptx, txt"], ["doc1", "csv", "pdf, docx, txt"]] as const) {
      const e = await err(h.run("gdrive_export", { account: "work", fileId: id, format, path: `bad/${id}.${format}` }, inCwd()));
      expect(e, `${id} ${format}`).toMatchObject({ code: "unsupported_export" });
      expect(e?.message).toContain(valids);
    }
    const pdf = await err(h.run("gdrive_export", { account: "work", fileId: "pdf1", format: "pdf", path: "bad/scan.pdf" }, inCwd()));
    expect(pdf).toMatchObject({ code: "unsupported_export" });
    expect(pdf?.message).toMatch(/gdrive_download/);
    expect(await err(h.run("gdrive_export", { account: "work", fileId: "doc1", format: "odt", path: "bad/x" }, inCwd()))).toMatchObject({ code: "invalid_params" });
    expect(existsSync(path.join(cwd, "bad"))).toBe(false);
    expect(readdirSync(path.join(cwd, "ok"))).toHaveLength(before);
  });

  it("#C55 download: a 5 MB binary is byte-identical (hash) and a 0-byte file is written with size 0", async () => {
    const big = randomBytes(5 * 1024 * 1024);
    const h = host([file("big", "big.bin", "application/octet-stream", { bytes: big }), file("zero", "empty", "text/plain", { bytes: Buffer.alloc(0) })]);
    const r = jsonOf<{ path: string; size: number }>(await h.run("gdrive_download", { account: "work", fileId: "big", path: "big.bin" }, inCwd()));
    expect(r).toEqual({ path: "big.bin", size: big.length });
    expect(sha(readFileSync(path.join(cwd, "big.bin")))).toBe(sha(big));
    expect(jsonOf(await h.run("gdrive_download", { account: "work", fileId: "zero", path: "zero.txt" }, inCwd()))).toEqual({ path: "zero.txt", size: 0 });
    expect(readFileSync(path.join(cwd, "zero.txt"))).toHaveLength(0);
    expect(h.google.to("GET", /^\/files\/big$/)[0]?.query.alt).toBe("media");
  });

  it("#C56/#GC11 abort mid-stream, 403 downloadRestricted / cannotDownloadFile, export over the size limit → drive_error and no partial file", async () => {
    const h = host([file("f1", "a.bin", "application/octet-stream", { bytes: randomBytes(100) }), file("doc1", "Huge", DOC)]);
    h.google.on("GET", /^\/files\/f1$/, { fail: "midstream", bytes: randomBytes(100) });
    expect(await err(h.run("gdrive_download", { account: "work", fileId: "f1", path: "out/a.bin" }, inCwd()))).toMatchObject({ code: "drive_error" });
    for (const reason of ["downloadRestricted", "cannotDownloadFile"]) {
      h.google.on("GET", /^\/files\/f1$/, googleError(403, reason, undefined, "This file cannot be downloaded"));
      expect(await err(h.run("gdrive_download", { account: "work", fileId: "f1", path: "out/a.bin" }, inCwd())), reason).toMatchObject({ code: "drive_error", status: 403 });
    }
    h.google.on("GET", /^\/files\/doc1\/export$/, googleError(403, "exportSizeLimitExceeded", undefined, "export too large"));
    h.google.on("GET", /^\/files\/doc1$/, { json: view(file("doc1", "Huge", DOC)) });
    const e = await err(h.run("gdrive_export", { account: "work", fileId: "doc1", format: "pdf", path: "out/huge.pdf" }, inCwd()));
    expect(e).toMatchObject({ code: "drive_error", status: 403 });
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("#C57 traversal refused for download and export: nothing written outside the cwd and no Drive request is made", async () => {
    const h = host(docs);
    const bad = ["../../.ssh/x", "/etc/x", "out/../../x", "C:\\x", "\\\\server\\share\\x"];
    for (const dest of bad) {
      expect(await err(h.run("gdrive_download", { account: "work", fileId: "pdf1", path: dest }, inCwd())), dest).toMatchObject({ code: "path_refused" });
      expect(await err(h.run("gdrive_export", { account: "work", fileId: "doc1", format: "pdf", path: dest }, inCwd())), dest).toMatchObject({ code: "path_refused" });
    }
    expect(h.google.calls).toHaveLength(0);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("#C58 a symlinked parent (1 or 2 hops) escaping the cwd is refused; a cwd that is itself a symlink works", async () => {
    const h = host([file("f1", "a.bin", "application/octet-stream", { bytes: Buffer.from("data") })]);
    symlinkSync(outside, path.join(cwd, "link"));
    mkdirSync(path.join(cwd, "hop"));
    symlinkSync(path.join(cwd, "link"), path.join(cwd, "hop", "two"));
    for (const dest of ["link/x.bin", "hop/two/x.bin", "link/new/x.bin"]) {
      expect(await err(h.run("gdrive_download", { account: "work", fileId: "f1", path: dest }, inCwd())), dest).toMatchObject({ code: "path_refused" });
    }
    expect(readdirSync(outside)).toEqual([]);
    expect(h.google.calls).toHaveLength(0);
    const holder = mkdtempSync(path.join(tmpdir(), "gdrive-hold-"));
    try {
      const linked = path.join(holder, "ws");
      symlinkSync(cwd, linked);
      await h.run("gdrive_download", { account: "work", fileId: "f1", path: "ok/x.bin" }, { hasUI: false, cwd: linked });
      expect(readFileSync(path.join(cwd, "ok", "x.bin"), "utf8")).toBe("data");
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  });

  it("#C59 never overwrites: an existing file, a symlink to a file and a directory all fail; content stays \"old\"; no .tmp residue", async () => {
    const h = host(docs, [WORK], { exports: { [DOCX]: Buffer.from("new") } });
    mkdirSync(path.join(cwd, "out"));
    writeFileSync(path.join(cwd, "out", "report.docx"), "old");
    writeFileSync(path.join(outside, "target"), "old");
    symlinkSync(path.join(outside, "target"), path.join(cwd, "out", "lnk.docx"));
    mkdirSync(path.join(cwd, "out", "adir"));
    for (const dest of ["out/report.docx", "out/lnk.docx", "out/adir"]) {
      expect(await err(h.run("gdrive_export", { account: "work", fileId: "doc1", format: "docx", path: dest }, inCwd())), dest).toBeInstanceOf(Error);
      expect(await err(h.run("gdrive_download", { account: "work", fileId: "pdf1", path: dest }, inCwd())), dest).toBeInstanceOf(Error);
    }
    expect(readFileSync(path.join(cwd, "out", "report.docx"), "utf8")).toBe("old");
    expect(readFileSync(path.join(outside, "target"), "utf8")).toBe("old");
    expect(readdirSync(path.join(cwd, "out")).sort()).toEqual(["adir", "lnk.docx", "report.docx"]);
  });

  it("#C60 two concurrent downloads to one new path: exactly one succeeds and the file holds the winner's bytes", async () => {
    const h = host([file("a", "a", "text/plain", { bytes: Buffer.from("AAAA") }), file("b", "b", "text/plain", { bytes: Buffer.from("BBBB") })]);
    const r = await Promise.allSettled([
      h.run("gdrive_download", { account: "work", fileId: "a", path: "race.bin" }, inCwd()),
      h.run("gdrive_download", { account: "work", fileId: "b", path: "race.bin" }, inCwd()),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(readFileSync(path.join(cwd, "race.bin"), "utf8")).toBe(r[0]?.status === "fulfilled" ? "AAAA" : "BBBB");
    expect(readdirSync(cwd)).toEqual(["race.bin"]);
  });

  it("#C61 destination names that are not a file name (NUL, 300 chars, `.`, `..`, trailing slash) are refused; nothing is written", async () => {
    const h = host(docs);
    for (const dest of ["a\0b", `${"n".repeat(300)}.bin`, ".", "..", "out/", "out\\"]) {
      expect(await err(h.run("gdrive_download", { account: "work", fileId: "pdf1", path: dest }, inCwd())), JSON.stringify(dest)).toMatchObject({ code: "path_refused" });
    }
    expect(h.google.calls).toHaveLength(0);
    expect(readdirSync(cwd)).toEqual([]);
  });
});

// ───────────────────────────── write tools ─────────────────────────────

describe("write tools", () => {
  const base = [file("F", "Reports", FOLDER), file("old1", "Archive", FOLDER), file("old2", "Inbox", FOLDER), file("x1", "notes.txt", "text/plain", { parents: ["old1", "old2"] })];

  it("#C63 confirmed upload of cwd/a.txt (12 B) to folder F: multipart with name/parents and the exact bytes; the summary lists account, name, size, folder", async () => {
    const h = host(base);
    writeFileSync(path.join(cwd, "a.txt"), "hello, world");
    const u = ui(true);
    const r = jsonOf<{ id: string; name: string }>(await h.run("gdrive_upload", { account: "work", path: "a.txt", folderId: "F", mimeType: "text/plain" }, u.ctx));
    expect(r).toMatchObject({ name: "a.txt" });
    const msg = confirmText(u);
    expect(msg).toContain("a@x.com");
    expect(msg).toContain("a.txt");
    expect(msg).toContain("12 B");
    expect(msg).toContain("Reports");
    const req = h.google.to("POST", "/upload/drive/v3/files")[0] as FakeRequest;
    expect(req.query.uploadType).toBe("multipart");
    const parts = multipart(req);
    expect(parts.meta).toEqual({ name: "a.txt", parents: ["F"], mimeType: "text/plain" });
    expect(parts.content.toString()).toBe("hello, world");
  });

  it("#C64 upload refused before the dialog and before any HTTP: /etc/passwd, ../x, symlink → outside file, a directory, a missing file", async () => {
    const h = host(base);
    writeFileSync(path.join(outside, "secret"), "s");
    symlinkSync(path.join(outside, "secret"), path.join(cwd, "lnk"));
    mkdirSync(path.join(cwd, "adir"));
    const u = ui(true);
    for (const p of ["/etc/passwd", "../x", "lnk", "adir", "missing.txt"]) {
      expect(await err(h.run("gdrive_upload", { account: "work", path: p }, u.ctx)), p).toMatchObject({ code: "path_refused" });
    }
    expect(u.confirm).not.toHaveBeenCalled();
    expect(h.google.calls).toHaveLength(0);
  });

  it("#C65/#GC12 upload sizes: 0 B and exactly 5 MiB go multipart; larger → file_too_large before the dialog (no read, no HTTP)", async () => {
    const h = host(base);
    writeFileSync(path.join(cwd, "zero"), "");
    writeFileSync(path.join(cwd, "five"), randomBytes(5 * 1024 * 1024));
    writeFileSync(path.join(cwd, "six"), "");
    truncateSync(path.join(cwd, "six"), 5 * 1024 * 1024 + 1);
    await h.run("gdrive_upload", { account: "work", path: "zero" }, ui(true).ctx);
    expect(multipart(h.google.to("POST", "/upload/drive/v3/files").at(-1) as FakeRequest).content).toHaveLength(0);
    await h.run("gdrive_upload", { account: "work", path: "five" }, ui(true).ctx);
    expect(multipart(h.google.to("POST", "/upload/drive/v3/files").at(-1) as FakeRequest).content).toHaveLength(5 * 1024 * 1024);
    const calls = h.google.calls.length;
    const u = ui(true);
    expect(await err(h.run("gdrive_upload", { account: "work", path: "six" }, u.ctx))).toMatchObject({ code: "file_too_large" });
    expect(u.confirm).not.toHaveBeenCalled();
    expect(h.google.calls).toHaveLength(calls);
  });

  it("#C66 denied / dismissed / no-UI: trash, move, create_folder and upload send no write request; the file stays", async () => {
    const h = host(base);
    writeFileSync(path.join(cwd, "a.txt"), "x");
    const calls: Array<[string, Record<string, unknown>]> = [
      ["gdrive_trash", { fileId: "x1" }],
      ["gdrive_move", { fileId: "x1", folderId: "F" }],
      ["gdrive_create_folder", { name: "New" }],
      ["gdrive_upload", { path: "a.txt" }],
    ];
    for (const [name, p] of calls) {
      expect(await err(h.run(name, { account: "work", ...p }, ui(false).ctx)), name).toMatchObject({ code: "denied" });
      expect(await err(h.run(name, { account: "work", ...p }, inCwd())), name).toMatchObject({ code: "blocked" });
    }
    expect(h.google.writes()).toHaveLength(0);
    expect(h.drive.get("x1")?.parents).toEqual(["old1", "old2"]);
  });

  it("#C67 confirmed trash: PATCH trashed:true (never DELETE); the result says it is recoverable from Trash", async () => {
    const h = host(base);
    const u = ui(true);
    const r = jsonOf<{ trashed: boolean; id: string; recoverable: string }>(await h.run("gdrive_trash", { account: "work", fileId: "x1" }, u.ctx));
    expect(r).toMatchObject({ trashed: true, id: "x1" });
    expect(r.recoverable).toMatch(/Trash/);
    expect(confirmText(u)).toContain("notes.txt");
    expect(h.google.writes().map((w) => w.method)).toEqual(["PATCH"]);
    expect(h.google.writes()[0]?.body).toEqual({ trashed: true });
    expect(h.google.to("DELETE")).toHaveLength(0);
  });

  it("#C68 move a file with 2 parents to F: addParents=F and removeParents=old1,old2; the summary shows the current and the target folder names", async () => {
    const h = host(base);
    const u = ui(true);
    await h.run("gdrive_move", { account: "work", fileId: "x1", folderId: "F" }, u.ctx);
    const w = h.google.writes();
    expect(w).toHaveLength(1);
    expect(w[0]?.query).toMatchObject({ addParents: "F", removeParents: "old1,old2" });
    const msg = confirmText(u);
    for (const s of ["notes.txt", "Archive", "Inbox", "Reports"]) expect(msg).toContain(s);
    expect(h.drive.get("x1")?.parents).toEqual(["F"]);
  });

  it("#C68 moving a folder into itself or its own descendant, a non-folder target, or a missing folder → drive_error, no dialog and no write", async () => {
    const tree = [file("A", "A", FOLDER), file("B", "B", FOLDER, { parents: ["A"] }), file("C", "C", FOLDER, { parents: ["B"] }), file("t1", "t.txt", "text/plain"), file("F", "F", FOLDER)];
    const h = host(tree);
    const u = ui(true);
    for (const [fileId, folderId] of [["A", "A"], ["A", "C"], ["A", "B"], ["F", "t1"], ["F", "nope"]]) {
      expect(await err(h.run("gdrive_move", { account: "work", fileId, folderId }, u.ctx)), `${fileId}→${folderId}`).toMatchObject({ code: "drive_error" });
    }
    expect(u.confirm).not.toHaveBeenCalled();
    expect(h.google.writes()).toHaveLength(0);
  });

  it("#C69 create_folder with `/` and unicode in the name; a duplicate name is allowed; the summary shows name and parent", async () => {
    const h = host(base);
    const u = ui(true);
    const r = jsonOf<{ id: string; name: string }>(await h.run("gdrive_create_folder", { account: "work", name: "Q1/Q2 – Übersicht ✓", parentId: "F" }, u.ctx));
    expect(r.name).toBe("Q1/Q2 – Übersicht ✓");
    expect(h.google.writes()[0]?.body).toEqual({ name: "Q1/Q2 – Übersicht ✓", mimeType: FOLDER, parents: ["F"] });
    expect(confirmText(u)).toContain("Q1/Q2 – Übersicht ✓");
    expect(confirmText(u)).toContain("Reports");
    await h.run("gdrive_create_folder", { account: "work", name: "Q1/Q2 – Übersicht ✓", parentId: "F" }, ui(true).ctx);
    expect(h.google.writes()).toHaveLength(2);
    await h.run("gdrive_create_folder", { account: "work", name: "Top" }, ui(true).ctx);
    expect(h.google.writes()[2]?.body).toEqual({ name: "Top", mimeType: FOLDER });
  });

  it("write tools need Drive on at some level: a disabled Drive is refused before any dialog", async () => {
    const h = host(base, [{ ...WORK, products: {} }]);
    const u = ui(true);
    expect(await err(h.run("gdrive_trash", { account: "work", fileId: "x1" }, u.ctx))).toMatchObject({ code: "product_disabled" });
    expect(u.confirm).not.toHaveBeenCalled();
  });
});
