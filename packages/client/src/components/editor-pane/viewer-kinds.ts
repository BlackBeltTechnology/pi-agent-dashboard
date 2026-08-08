/**
 * Viewer-kind partition — a component-free leaf module.
 *
 * Splits the closed `ViewerKind` union into the two halves the editor pane
 * dispatches on:
 *
 *  - `OPEN_PATH_VIEWERS` (14) — kinds `fileKind()` can return for a real file.
 *  - `PSEUDO_TAB_VIEWERS` (4)  — kinds reachable only by an explicit open under
 *    a virtual path (`diff:`, `term:`, `url:`, `live:`).
 *
 * This module MUST NOT import any viewer component. `CappedViewer` imports
 * `OpenPathViewer` from here and `DiffFilePreview` imports the guard, so
 * putting these in the pseudo-tab registry half would re-form the cycle
 * `CappedViewer -> (b) -> DiffViewer -> DiffPanel -> DiffFilePreview ->
 * CappedViewer`.
 *
 * See change: cleanup-import-cycles (D3).
 */

import type { ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";

/**
 * Viewers reachable only by an explicit open, never returned by `fileKind()`.
 * Their tab paths are virtual (`diff:<rel>`, `term:<id>`, `url:<url>`,
 * `live:<url>`), so a file-metadata probe against them is meaningless.
 */
export const PSEUDO_TAB_VIEWERS = ["diff", "terminal", "url", "live-server"] as const;

/**
 * Viewers `fileKind()` can return for a real file. Kept as a runtime value
 * because `ViewerKind` is a type with no runtime representation and
 * `packages/shared` is out of scope for this change — the checks below are what
 * prove this array stays exactly in step with the union.
 */
export const OPEN_PATH_VIEWERS = [
  "asciidoc",
  "audio",
  "binary-warn",
  "docx",
  "email",
  "html",
  "image",
  "markdown",
  "mermaid",
  "monaco",
  "pdf",
  "pptx",
  "spreadsheet",
  "video",
] as const;

export type PseudoTabViewer = (typeof PSEUDO_TAB_VIEWERS)[number];
export type OpenPathViewer = Exclude<ViewerKind, PseudoTabViewer>;

/**
 * The only correct discriminator for the editor-pane dispatch.
 *
 * NOT `fileKind(path).viewer` — that is called for every tab including
 * pseudo-tab paths, where it returns wrong-but-currently-harmless results
 * (`diff:src/foo.ts` classifies as `monaco`). TypeScript does not narrow a
 * string-literal union through a bare `.includes()`, hence the explicit
 * predicate signature.
 */
export function isPseudoTabViewer(v: ViewerKind): v is PseudoTabViewer {
  return (PSEUDO_TAB_VIEWERS as readonly string[]).includes(v);
}

/*
 * Compile-time proof that the two arrays exactly partition `ViewerKind`.
 *
 * The `_AssertNever<T extends never>` form is load-bearing: the more obvious
 * `const _x: SomeType[] = []` is VACUOUS, because an empty array literal is
 * assignable to every array type including `never[]`, so it compiles whether or
 * not the arrays cover the union. Verified against this repo's tsc.
 *
 * What these DO prove: total coverage, no stray member in either array, and
 * disjointness. What they do NOT prove: that each kind sits in the *correct*
 * half — swapping a member between the arrays still partitions the union. That
 * is covered by the runtime decision-table test (test-plan #E6).
 */
type _AssertNever<T extends never> = T;
type _Uncovered = _AssertNever<
  Exclude<ViewerKind, (typeof OPEN_PATH_VIEWERS)[number] | (typeof PSEUDO_TAB_VIEWERS)[number]>
>;
type _NoExtraOpen = _AssertNever<Exclude<(typeof OPEN_PATH_VIEWERS)[number], ViewerKind>>;
type _NoExtraPseudo = _AssertNever<Exclude<(typeof PSEUDO_TAB_VIEWERS)[number], ViewerKind>>;
type _NoOverlap = _AssertNever<
  Extract<(typeof OPEN_PATH_VIEWERS)[number], (typeof PSEUDO_TAB_VIEWERS)[number]>
>;
