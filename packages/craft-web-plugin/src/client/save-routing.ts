/**
 * Pure routing of a shim `save` (design D4 "Save mapping"). Stems and extensions are
 * compared like core's extension matching: Unicode NFC, lower-case.
 *
 * Order: other extension → device download (never a workspace write, any size);
 * over the claim cap → `too-large` (nothing can be written; the host offers a download);
 * same stem → `own` (`props.save` with the Save-target toggle); other stem → `save-as`
 * (host dialog). See change: edit-office-in-pane-with-craft-web.
 */

export type SaveRoute = "own" | "save-as" | "download" | "too-large";

export const baseName = (path: string): string => path.replace(/\\/g, "/").split("/").pop() ?? path;

const norm = (s: string): string => s.normalize("NFC").toLowerCase();

/** `{stem, ext}` of a file name; `ext` includes the dot ("" when none). */
export function splitName(name: string): { stem: string; ext: string } {
  const base = norm(baseName(name));
  const i = base.lastIndexOf(".");
  return i > 0 ? { stem: base.slice(0, i), ext: base.slice(i) } : { stem: base, ext: "" };
}

export function routeSave(opts: { suggestedName: string; tabPath: string; byteLength: number; maxBytes: number }): SaveRoute {
  const want = splitName(opts.suggestedName);
  const tab = splitName(opts.tabPath);
  if (want.ext !== tab.ext) return "download";
  if (opts.byteLength > opts.maxBytes) return "too-large";
  return want.stem === tab.stem ? "own" : "save-as";
}
