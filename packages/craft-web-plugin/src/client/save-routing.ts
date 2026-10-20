/**
 * Pure routing of a shim `save` (design D4 "Save mapping", D6, D10). Stems and extensions are
 * compared like core's extension matching: Unicode NFC, lower-case.
 *
 * Order:
 *  - view-only (preview) claim → device download, any name;
 *  - a declared native sibling extension → `sibling` (a new `<stem><ext>` next to the tab's file), unless over
 *    the claim cap (`too-large`);
 *  - any other extension → device download (never a workspace write, any size);
 *  - over the claim cap → `too-large` (nothing can be written; the host offers a download);
 *  - `inner-title` apps (the app names saves after content inside the file, D10): the first save under a
 *    suggested name always asks (`save-as`); once answered for that name → `own` (the host applies the
 *    remembered answer);
 *  - same stem → `own` (`props.save` with the Save-target toggle); other stem → `save-as` (host dialog).
 *
 * See change: edit-office-in-pane-with-craft-web, extend-craft-web-to-all-apps (D6, D10).
 */

export type SaveRoute = "own" | "save-as" | "sibling" | "download" | "too-large";

export const baseName = (path: string): string => path.replace(/\\/g, "/").split("/").pop() ?? path;

const norm = (s: string): string => s.normalize("NFC").toLowerCase();

/** `{stem, ext}` of a file name; `ext` includes the dot ("" when none). */
export function splitName(name: string): { stem: string; ext: string } {
  const base = norm(baseName(name));
  const i = base.lastIndexOf(".");
  return i > 0 ? { stem: base.slice(0, i), ext: base.slice(i) } : { stem: base, ext: "" };
}

/** Key of a suggested name for remembered Save As answers (NFC + lower-case base name). */
export const saveNameKey = (name: string): string => norm(baseName(name));

export interface RouteSaveOptions {
  suggestedName: string;
  tabPath: string;
  byteLength: number;
  maxBytes: number;
  /** Claim's native sibling extensions (lower-case, dotted); absent on an older runtime → none. */
  siblingExtensions?: readonly string[];
  /** Profile save-name rule; `inner-title` asks once per suggested name. */
  saveName?: "stem" | "inner-title";
  /** Suggested names (`saveNameKey`) with a remembered Save As answer in this instance. */
  remembered?: ReadonlySet<string>;
  /** View-only claim: every save is a device download. */
  preview?: boolean;
}

export function routeSave(opts: RouteSaveOptions): SaveRoute {
  if (opts.preview) return "download";
  const want = splitName(opts.suggestedName);
  const tab = splitName(opts.tabPath);
  const over = opts.byteLength > opts.maxBytes;
  if (want.ext !== tab.ext) {
    if (opts.siblingExtensions?.includes(want.ext)) return over ? "too-large" : "sibling";
    return "download";
  }
  if (over) return "too-large";
  if (opts.saveName === "inner-title") return opts.remembered?.has(saveNameKey(opts.suggestedName)) ? "own" : "save-as";
  return want.stem === tab.stem ? "own" : "save-as";
}

/** Sibling target name: the tab's own stem (original case) + the sibling extension. */
export function siblingName(tabPath: string, ext: string): string {
  const base = baseName(tabPath);
  const i = base.lastIndexOf(".");
  return `${i > 0 ? base.slice(0, i) : base}${ext}`;
}
