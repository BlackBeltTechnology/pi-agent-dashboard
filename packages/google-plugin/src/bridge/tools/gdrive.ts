/**
 * Google Drive tools (`gdrive_*`, design D9 + D11; spec google-drive-tools). Every tool works from level `files`
 * (only files this app created or the user picked); `read`/`write` just widen what Google lets the token see.
 * Reads: `gdrive_search`/`_get`/`_pick`/`_download`/`_export`. Writes (confirmed first): `gdrive_upload`,
 * `_create_folder`, `_move`, `_trash` — never a permanent delete, never sharing.
 * Files on disk stay inside the session cwd (`shared/workspace-path.ts`): the path is validated BEFORE any
 * Drive request, nothing is overwritten, and only complete downloads are written (temp file, then link).
 * Scenario-gate C9–C12: picker cancel/timeout → `{ files: [] }` (5 min); `unsupported_export`; ≤ 5 MB upload.
 * See change: add-google-connect.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { PICKER_TIMEOUT_MS, type PickedFile, parsePickerAnswer, pickerPluginMeta } from "../../shared/picker.js";
import { commitSave, PathRefusedError, planSave, readInsideCwd } from "../../shared/workspace-path.js";
import { pageSize } from "../paging.js";
import { oneOf, optInt, optStr, type Params, reqStr } from "../params.js";
import { clip } from "../preview.js";
import type { Call, ProductTools, ToolOutput } from "../runtime.js";
import { GoogleToolError } from "../tool-error.js";

const enc = encodeURIComponent;
/** Multipart upload ceiling (scenario-gate C12); larger files are refused, not resumed. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";

/** Search `type` → MIME; the same names label results. */
const TYPE_MIME = {
  document: GOOGLE_DOC,
  spreadsheet: GOOGLE_SHEET,
  presentation: GOOGLE_SLIDES,
  folder: FOLDER,
  pdf: "application/pdf",
} as const;
const TYPES = Object.keys(TYPE_MIME) as Array<keyof typeof TYPE_MIME>;
const typeOf = (mime: string | undefined): string => TYPES.find((t) => TYPE_MIME[t] === mime) ?? mime ?? "unknown";

const EXPORT_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
} as const;
type ExportFormat = keyof typeof EXPORT_MIME;
const FORMATS = Object.keys(EXPORT_MIME) as ExportFormat[];
/** What each Google file type can be exported to (valid combinations, scenario-gate C10). */
const EXPORTABLE: Record<string, { label: string; formats: readonly ExportFormat[] }> = {
  [GOOGLE_DOC]: { label: "Google Doc", formats: ["pdf", "docx", "txt"] },
  [GOOGLE_SHEET]: { label: "Google Sheet", formats: ["pdf", "xlsx", "csv"] },
  [GOOGLE_SLIDES]: { label: "Google Slides file", formats: ["pdf", "pptx", "txt"] },
};

const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,webViewLink,size";

interface GFile {
  id?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
}

const LEVEL_NOTE =
  'Drive is at level "files": only files this app created or you picked with gdrive_pick are visible; existing files in the user\'s Drive are not (raise the level with an own OAuth client to read them).';
const PICKER_WHY = "the Google file picker is only available for the built-in Google app, in a browser on the dashboard host";

// ───────────── helpers ─────────────

/** A Drive query string literal: backslash and quote escaped, so user text can never end the literal. */
const lit = (s: string): string => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function row(f: GFile): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    type: typeOf(f.mimeType),
    ...(f.parents?.[0] ? { parent: f.parents[0] } : {}),
    ...(f.modifiedTime ? { modifiedTime: f.modifiedTime } : {}),
    ...(f.webViewLink ? { webViewLink: f.webViewLink } : {}),
  };
}

/** At level `files` a 404 usually means "not yours to see": say so (the agent would otherwise retry). */
function withLevelNote(call: Call, e: unknown): never {
  if (e instanceof GoogleToolError && e.status === 404 && call.lease.level === "files") {
    throw new GoogleToolError(e.code, `${e.message}. ${LEVEL_NOTE}`, { status: 404, ...(e.reason ? { reason: e.reason } : {}) });
  }
  throw e;
}

async function getFile(call: Call, id: string, fields = FILE_FIELDS): Promise<GFile> {
  try {
    return await call.api.request<GFile>("GET", `/files/${enc(id)}`, { query: { fields } });
  } catch (e) {
    return withLevelNote(call, e);
  }
}

/** A folder by id (name for dialogs), or an error when it is not one. */
async function getFolder(call: Call, id: string): Promise<GFile> {
  const f = await getFile(call, id, "id,name,mimeType,parents");
  if (f.mimeType !== FOLDER) throw new GoogleToolError("drive_error", `drive_error: ${clip(f.name ?? id, 80)} is not a folder`);
  return f;
}

/** Path problems → their stable codes (never raw fs errors); messages name no absolute path. */
async function pathGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PathRefusedError) {
      if (e.code === "too_large") throw new GoogleToolError("file_too_large", `file_too_large: the file exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`);
      throw new GoogleToolError("path_refused", e.message);
    }
    throw new GoogleToolError("path_refused", "path_refused: the file could not be read or written inside the working directory");
  }
}

/** A body that did not arrive intact (connection dropped mid-stream) is a Drive failure, not a crash. */
async function transfer<T>(call: Call, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GoogleToolError) return withLevelNote(call, e);
    throw new GoogleToolError("drive_error", "drive_error: the Google Drive transfer was interrupted; nothing was written");
  }
}

function cwdOf(call: Call): string {
  const cwd = call.ctx?.cwd;
  if (!cwd) throw new GoogleToolError("path_refused", "path_refused: no session working directory is known");
  return cwd;
}

const sizeText = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const place = (f: GFile | undefined, fallback: string): string => (f?.name ? `${clip(f.name, 120)} (${f.id})` : fallback);

/** Names of a file's parent folders for a dialog (≤ 5); an unreadable parent shows as its id. */
async function parentNames(call: Call, parents: readonly string[] | undefined): Promise<string[]> {
  const names: string[] = [];
  for (const id of (parents ?? []).slice(0, 5)) {
    names.push(await getFile(call, id, "id,name").then((f) => place(f, id), () => id));
  }
  return names;
}

/** Is `folderId` inside `ancestorId` (or the same)? Walks parents with a bounded number of reads; unreadable folders end a branch. */
async function isInside(call: Call, folderId: string, ancestorId: string): Promise<boolean> {
  const seen = new Set<string>();
  const queue = [folderId];
  while (queue.length && seen.size < 64) {
    const id = queue.shift() as string;
    if (id === ancestorId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const f = await getFile(call, id, "id,parents").catch(() => undefined);
    queue.push(...(f?.parents ?? []));
  }
  return false;
}

// ───────────── the tools ─────────────

export const gdrive: ProductTools = {
  product: "drive",
  create(rt) {
    return [
      rt.define<{ q: string; size: number; pageToken?: string }>({
        name: "gdrive_search",
        label: "search files",
        description:
          'Search Google Drive files by text, name, type or folder (any combination; trashed files are excluded). Returns id, name, type, parent, modifiedTime, webViewLink and a nextPageToken when there are more. At Drive level "files" only files this app created or you picked are visible.',
        properties: {
          text: { type: "string", description: "Full-text match (file contents and names)." },
          name: { type: "string", description: "Name contains." },
          type: { type: "string", enum: TYPES },
          folderId: { type: "string", description: "Only direct children of this folder." },
          pageSize: { type: "integer", minimum: 1, maximum: 50 },
          pageToken: { type: "string" },
        },
        level: "files",
        parse: (p) => {
          const clauses = ["trashed = false"];
          const text = optStr(p, "text", 1000);
          const name = optStr(p, "name", 1000);
          const folder = optStr(p, "folderId", 200);
          if (text) clauses.push(`fullText contains ${lit(text)}`);
          if (name) clauses.push(`name contains ${lit(name)}`);
          if (p.type !== undefined && p.type !== null) clauses.push(`mimeType = ${lit(TYPE_MIME[oneOf(p, "type", TYPES)])}`);
          if (folder) clauses.push(`${lit(folder)} in parents`);
          const token = optStr(p, "pageToken", 2000);
          return { q: clauses.join(" and "), size: pageSize(optInt(p, "pageSize", { min: 1, max: 50 })), ...(token ? { pageToken: token } : {}) };
        },
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<{ files?: GFile[]; nextPageToken?: string }>("GET", "/files", {
            query: { q: a.q, pageSize: a.size, pageToken: a.pageToken, orderBy: "modifiedTime desc", fields: `nextPageToken,files(${FILE_FIELDS})` },
          });
          return {
            json: {
              files: (r.files ?? []).map(row),
              ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}),
              ...(call.lease.level === "files" ? { note: LEVEL_NOTE } : {}),
            },
          };
        },
      }),

      rt.define<{ id: string }>({
        name: "gdrive_get",
        label: "get file metadata",
        description: "Metadata of one Drive file or folder: id, name, type, parent, modifiedTime, webViewLink, size.",
        properties: { fileId: { type: "string" } },
        required: ["fileId"],
        level: "files",
        parse: (p) => ({ id: reqStr(p, "fileId", 200) }),
        async run(a, call): Promise<ToolOutput> {
          const f = await getFile(call, a.id);
          return { json: { ...row(f), mimeType: f.mimeType, ...(f.size ? { size: Number(f.size) } : {}) } };
        },
      }),

      rt.define<Record<string, never>>({
        name: "gdrive_pick",
        label: "pick files",
        description:
          'Ask the user to pick Drive files in the dashboard with Google\'s file picker; returns the picked files ({id,name,type}); picked files become readable (gdrive_get/_download/_export). Only for the built-in Google app in a browser on the dashboard host, otherwise fails with picker_unavailable. An empty list means nothing was picked (cancelled or 5 min timeout).',
        properties: {},
        level: "files",
        parse: () => ({}),
        async run(_a, call): Promise<ToolOutput> {
          const input = call.ctx?.hasUI ? call.ctx.ui?.input : undefined;
          if (!input) throw unavailable("the dashboard UI is not available to this session");
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), PICKER_TIMEOUT_MS);
          });
          let raw: string | undefined;
          try {
            raw = await Promise.race([
              input.call(call.ctx?.ui, "Google Drive: pick files", "Waiting for the Google file picker in this dashboard tab\u2026", { timeout: PICKER_TIMEOUT_MS, pluginMeta: pickerPluginMeta(call.account) }),
              timeout,
            ]);
          } catch {
            raw = undefined; // dismissed prompt = nothing picked
          } finally {
            clearTimeout(timer);
          }
          const answer = parsePickerAnswer(raw);
          if ("error" in answer) throw unavailable(answer.reason ?? PICKER_WHY);
          return { json: { files: answer.files.map((f: PickedFile) => ({ id: f.id, name: f.name, type: typeOf(f.mimeType) })) } };
        },
      }),

      rt.define<{ id: string; dest: string }>({
        name: "gdrive_download",
        label: "download file",
        description: "Download a binary Drive file (not a Google Doc/Sheet/Slides - use gdrive_export) to a NEW path inside the working directory; parent folders are created; an existing file is never overwritten.",
        properties: { fileId: { type: "string" }, path: { type: "string", description: "Destination, relative to the working directory." } },
        required: ["fileId", "path"],
        level: "files",
        parse: (p) => ({ id: reqStr(p, "fileId", 200), dest: reqStr(p, "path", 4096) }),
        async run(a, call): Promise<ToolOutput> {
          const plan = await pathGuard(() => planSave(cwdOf(call), a.dest));
          const bytes = await transfer(call, () => call.api.request<Buffer>("GET", `/files/${enc(a.id)}`, { query: { alt: "media" }, as: "bytes" }));
          await pathGuard(() => commitSave(plan, bytes));
          return { json: { path: a.dest, size: bytes.length } };
        },
      }),

      rt.define<{ id: string; format: ExportFormat; dest: string }>({
        name: "gdrive_export",
        label: "export file",
        description: `Export a Google Doc (pdf, docx, txt), Sheet (pdf, xlsx, csv) or Slides file (pdf, pptx, txt) to a NEW path inside the working directory (parent folders are created; nothing is overwritten). Google caps an export at 10 MB.`,
        properties: { fileId: { type: "string" }, format: { type: "string", enum: FORMATS }, path: { type: "string", description: "Destination, relative to the working directory." } },
        required: ["fileId", "format", "path"],
        level: "files",
        parse: (p) => ({ id: reqStr(p, "fileId", 200), format: oneOf(p, "format", FORMATS), dest: reqStr(p, "path", 4096) }),
        async run(a, call): Promise<ToolOutput> {
          const plan = await pathGuard(() => planSave(cwdOf(call), a.dest));
          const f = await getFile(call, a.id, "id,name,mimeType");
          const source = EXPORTABLE[f.mimeType ?? ""];
          if (!source) {
            throw new GoogleToolError("unsupported_export", `unsupported_export: ${clip(f.name ?? a.id, 80)} is not a Google Doc, Sheet or Slides file (${f.mimeType ?? "unknown type"}); use gdrive_download for binary files`);
          }
          if (!source.formats.includes(a.format)) {
            throw new GoogleToolError("unsupported_export", `unsupported_export: a ${source.label} can be exported as ${source.formats.join(", ")} (not ${a.format})`);
          }
          const bytes = await transfer(call, () => call.api.request<Buffer>("GET", `/files/${enc(a.id)}/export`, { query: { mimeType: EXPORT_MIME[a.format] }, as: "bytes" }));
          await pathGuard(() => commitSave(plan, bytes));
          return { json: { path: a.dest, size: bytes.length } };
        },
      }),

      rt.define<{ src: string; folderId?: string; name?: string; mime: string }, { content: Buffer; name: string; folder?: GFile }>({
        name: "gdrive_upload",
        label: "upload file",
        description: `Upload a file from the working directory (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB) to Drive, into a folder (default: My Drive root). The user confirms first, seeing the account, file name, size and folder. Set mimeType for anything that is not a plain binary.`,
        properties: {
          path: { type: "string", description: "File to upload, relative to the working directory." },
          folderId: { type: "string", description: "Target folder id (default: My Drive root)." },
          name: { type: "string", description: "Name in Drive (default: the file name)." },
          mimeType: { type: "string", description: "e.g. text/plain, application/pdf (default application/octet-stream)." },
        },
        required: ["path"],
        level: "files",
        write: true,
        parse: (p) => ({ src: reqStr(p, "path", 4096), folderId: optStr(p, "folderId", 200), name: optStr(p, "name", 255), mime: mimeArg(p) }),
        async prepare(a, call) {
          // File first: a refused path or an oversized file ends the call before any Drive request or dialog.
          const content = await pathGuard(() => readInsideCwd(cwdOf(call), a.src, MAX_UPLOAD_BYTES));
          const folder = a.folderId ? await getFolder(call, a.folderId) : undefined;
          return { content, name: a.name ?? path.basename(a.src), ...(folder ? { folder } : {}) };
        },
        summary: (_a, s) => [`Upload: ${clip(s.name, 200)} (${sizeText(s.content.length)})`, `To folder: ${s.folder ? place(s.folder, "?") : "My Drive (root)"}`],
        async run(a, call, s): Promise<ToolOutput> {
          const boundary = `pi-google-${randomBytes(12).toString("hex")}`;
          const meta = { name: s.name, ...(a.folderId ? { parents: [a.folderId] } : {}), mimeType: a.mime };
          const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${a.mime}\r\n\r\n`);
          const data = Buffer.concat([head, s.content, Buffer.from(`\r\n--${boundary}--`)]);
          const f = await call.api.request<GFile>("POST", "/files", {
            base: call.api.base.replace(/\/drive\/v3$/, "/upload/drive/v3"),
            query: { uploadType: "multipart", fields: FILE_FIELDS },
            raw: { data, contentType: `multipart/related; boundary=${boundary}` },
          });
          return { json: { uploaded: true, ...row(f), size: s.content.length } };
        },
      }),

      rt.define<{ name: string; parentId?: string }, GFile | undefined>({
        name: "gdrive_create_folder",
        label: "create folder",
        description: "Create a Drive folder (default: in My Drive root). The user confirms first. A folder with the same name may already exist; Drive allows duplicates.",
        properties: { name: { type: "string" }, parentId: { type: "string", description: "Parent folder id (default: My Drive root)." } },
        required: ["name"],
        level: "files",
        write: true,
        parse: (p) => ({ name: plainName(p), parentId: optStr(p, "parentId", 200) }),
        prepare: (a, call) => (a.parentId ? getFolder(call, a.parentId) : Promise.resolve(undefined)),
        summary: (a, parent) => [`Create folder: ${clip(a.name, 200)}`, `In folder: ${parent ? place(parent, "?") : "My Drive (root)"}`],
        async run(a, call): Promise<ToolOutput> {
          const f = await call.api.request<GFile>("POST", "/files", { query: { fields: FILE_FIELDS }, body: { name: a.name, mimeType: FOLDER, ...(a.parentId ? { parents: [a.parentId] } : {}) } });
          return { json: { created: true, ...row(f) } };
        },
      }),

      rt.define<{ id: string; folderId: string }, { file: GFile; target: GFile; from: string[] }>({
        name: "gdrive_move",
        label: "move file",
        description: "Move a Drive file or folder into another folder (it leaves all its current folders). The user confirms first, seeing the current and the target folder.",
        properties: { fileId: { type: "string" }, folderId: { type: "string", description: "Target folder id." } },
        required: ["fileId", "folderId"],
        level: "files",
        write: true,
        parse: (p) => ({ id: reqStr(p, "fileId", 200), folderId: reqStr(p, "folderId", 200) }),
        async prepare(a, call) {
          if (a.id === a.folderId) throw new GoogleToolError("drive_error", "drive_error: a folder cannot be moved into itself");
          const file = await getFile(call, a.id, "id,name,mimeType,parents");
          const target = await getFolder(call, a.folderId);
          if (file.mimeType === FOLDER && (await isInside(call, a.folderId, a.id))) {
            throw new GoogleToolError("drive_error", "drive_error: a folder cannot be moved into one of its own subfolders");
          }
          return { file, target, from: await parentNames(call, file.parents) };
        },
        summary: (_a, s) => [`Move: ${place(s.file, "?")}`, `From: ${s.from.join(", ") || "(no folder)"}`, `To folder: ${place(s.target, "?")}`],
        async run(a, call, s): Promise<ToolOutput> {
          const old = (s.file.parents ?? []).join(",");
          const f = await call.api.request<GFile>("PATCH", `/files/${enc(a.id)}`, { query: { addParents: a.folderId, ...(old ? { removeParents: old } : {}), fields: FILE_FIELDS } });
          return { json: { moved: true, ...row(f) } };
        },
      }),

      rt.define<{ id: string }, GFile>({
        name: "gdrive_trash",
        label: "trash file",
        description: "Move a Drive file or folder to the Trash (recoverable from Trash; never a permanent delete). The user confirms first.",
        properties: { fileId: { type: "string" } },
        required: ["fileId"],
        level: "files",
        write: true,
        parse: (p) => ({ id: reqStr(p, "fileId", 200) }),
        prepare: (a, call) => getFile(call, a.id, "id,name,mimeType"),
        summary: (_a, f) => [`Move to Trash: ${place(f, "?")}`, "Recoverable from the Drive Trash."],
        async run(a, call, f): Promise<ToolOutput> {
          await call.api.request("PATCH", `/files/${enc(a.id)}`, { query: { fields: "id" }, body: { trashed: true } });
          return { json: { trashed: true, id: a.id, name: f.name, recoverable: "The file is in the Google Drive Trash and can be restored from there." } };
        },
      }),
    ];
  },
};

const unavailable = (why: string): GoogleToolError =>
  new GoogleToolError(
    "picker_unavailable",
    `picker_unavailable: ${why}. At level "files" only files created by this app are visible; to read other files use an own OAuth client with the Drive read level.`,
  );

const MIME = /^[\w.+-]{1,100}\/[\w.+-]{1,200}$/;
function mimeArg(p: Params): string {
  const v = optStr(p, "mimeType", 300);
  if (v === undefined) return "application/octet-stream";
  if (!MIME.test(v)) throw new GoogleToolError("invalid_params", "invalid_params: `mimeType` must look like type/subtype");
  return v;
}

/** A Drive name: any text without control characters (so `/` and unicode are fine). */
function plainName(p: Params): string {
  const v = reqStr(p, "name", 255);
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new GoogleToolError("invalid_params", "invalid_params: `name` must not contain control characters");
  return v;
}
