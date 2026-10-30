/**
 * Media-project plumbing (pure, browser + node): FilmCraft `.fcproj` references media by disk path, the web
 * build resolves only `/files/<name>`. This module parses the project, plans which referenced media the host
 * may deliver (confined to the project's folder, bounded), rewrites delivered paths to `/files/<vfsName>` on
 * open and restores the exact original strings on save.
 *
 * Hardening: explicit field access only (`Object.hasOwn`, no recursive walk or merge); the name map is a `Map`.
 * See change: add-craft-web-media-projects (D1-D5).
 */

export interface MediaProjectLimits {
  /** Largest project file parsed. */
  projectMaxBytes: number;
  /** Largest single medium. */
  mediaMaxBytes: number;
  /** Total media bytes per project. */
  mediaMaxTotalBytes: number;
  /** Most media planned per project. */
  mediaMaxFiles: number;
}

/** One medium the host may deliver. */
export interface MediaRef {
  /** Path string exactly as the project holds it. */
  raw: string;
  /** cwd-relative path to read through the workspace read. */
  readPath: string;
  /** Name inside the app (`/files/<vfsName>`). */
  vfsName: string;
}

export interface MediaPlan {
  refs: MediaRef[];
  /** Referenced media that will not be delivered (unresolvable, outside the folder, over the count bound). */
  missing: number;
}

/** Parsed FilmCraft project (opaque JSON object). */
export type ProjectJson = Record<string, unknown>;

const FORMAT = "filmcraft.project";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

/** Parse a `.fcproj`; null when over the cap, not JSON, or not a FilmCraft project. */
export function parseProject(bytes: Uint8Array, maxBytes: number): ProjectJson | null {
  if (bytes.byteLength > maxBytes) return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isObj(json) || own(json, "format") !== FORMAT || !isObj(own(json, "project"))) return null;
  return json;
}

/** Call `visit(item, pathHolder)` for each `project.items.<id>.kind.Media.media.File` that has a string `path`. */
function eachFileHolder(json: ProjectJson, visit: (file: Record<string, unknown>) => void): void {
  const project = own(json, "project");
  const items = isObj(project) ? own(project, "items") : undefined;
  if (!isObj(items)) return;
  for (const key of Object.keys(items)) {
    const item = own(items, key);
    const kind = isObj(item) ? own(item, "kind") : undefined;
    const mediaKind = isObj(kind) ? own(kind, "Media") : undefined;
    const media = isObj(mediaKind) ? own(mediaKind, "media") : undefined;
    const file = isObj(media) ? own(media, "File") : undefined;
    if (isObj(file) && typeof own(file, "path") === "string") visit(file);
  }
}

/**
 * Resolve a project-referenced path to a cwd-relative one, only when it stays inside the project's folder
 * (`projectDir`, cwd-relative, "" for the cwd). Relative paths resolve against that folder; an absolute path
 * must lie under `<cwd>/<projectDir>`. Backslashes, drive letters, NUL and `..` that leaves the folder → null.
 */
export function resolveMediaPath(projectDir: string, raw: string, cwd: string): string | null {
  if (!raw || raw.includes("\0") || raw.includes("\\") || /^[A-Za-z]:/.test(raw)) return null;
  const root = [cwd.replace(/\/+$/, ""), projectDir].filter(Boolean).join("/");
  let rel: string;
  if (raw.startsWith("/")) {
    if (!raw.startsWith(`${root}/`)) return null;
    rel = raw.slice(root.length + 1);
  } else {
    rel = raw;
  }
  const out: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  if (out.length === 0) return null;
  return [projectDir, ...out].filter(Boolean).join("/");
}

/** Plan the delivery: distinct raw paths in the order the project first references them. */
export function planMedia(json: ProjectJson, projectDir: string, cwd: string, limits: MediaProjectLimits): MediaPlan {
  const seen = new Set<string>();
  const names = new Set<string>();
  const refs: MediaRef[] = [];
  let missing = 0;
  eachFileHolder(json, (file) => {
    const raw = file.path as string;
    if (seen.has(raw)) return;
    seen.add(raw);
    const readPath = resolveMediaPath(projectDir, raw, cwd);
    if (readPath === null || refs.length >= limits.mediaMaxFiles) {
      missing++;
      return;
    }
    const base = readPath.slice(readPath.lastIndexOf("/") + 1);
    let vfsName = base;
    for (let n = 2; names.has(vfsName); n++) vfsName = `${n}-${base}`;
    names.add(vfsName);
    refs.push({ raw, readPath, vfsName });
  });
  return { refs, missing };
}

/** Folder of the project file, cwd-relative ("" for the cwd itself); null when the file is not under `cwd`. */
export function projectDirOf(cwd: string, filePath: string): string | null {
  const root = cwd.replace(/\/+$/, "");
  let rel = filePath;
  if (filePath.startsWith("/")) {
    if (!filePath.startsWith(`${root}/`)) return null;
    rel = filePath.slice(root.length + 1);
  }
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

/** Size gate applied to the ACTUAL size of each medium read (per file and in total). */
export class MediaBudget {
  private total = 0;
  private readonly limits: MediaProjectLimits;
  constructor(limits: MediaProjectLimits) {
    this.limits = limits;
  }
  /** Largest next medium that can still be admitted (read-time cap for the response size). */
  limit(): number {
    return Math.min(this.limits.mediaMaxBytes, this.limits.mediaMaxTotalBytes - this.total);
  }
  admit(size: number): boolean {
    if (size > this.limits.mediaMaxBytes || this.total + size > this.limits.mediaMaxTotalBytes) return false;
    this.total += size;
    return true;
  }
}

const encode = (json: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(json));

/** Replace the delivered media's paths with `/files/<vfsName>`; returns the bytes and `/files/<name>` → original. */
export function rewriteProject(json: ProjectJson, delivered: readonly MediaRef[]): { bytes: Uint8Array; map: Map<string, string> } {
  const byRaw = new Map(delivered.map((r) => [r.raw, r.vfsName]));
  const map = new Map<string, string>();
  eachFileHolder(json, (file) => {
    const vfs = byRaw.get(file.path as string);
    if (vfs === undefined) return;
    map.set(`/files/${vfs}`, file.path as string);
    file.path = `/files/${vfs}`;
  });
  return { bytes: encode(json), map };
}

/** Put the original path strings back into saved bytes. Non-JSON input is returned as is. */
export function restoreProject(bytes: Uint8Array, map: ReadonlyMap<string, string>): Uint8Array {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return bytes;
  }
  if (!isObj(json)) return bytes;
  eachFileHolder(json, (file) => {
    const orig = map.get(file.path as string);
    if (orig !== undefined) file.path = orig;
  });
  return encode(json);
}
