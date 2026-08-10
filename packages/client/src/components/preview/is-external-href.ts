/**
 * External-link predicate — a leaf module with no dependencies.
 *
 * Extracted from `MarkdownContent.tsx` to break the import cycle
 * `MarkdownContent -> FrontmatterProperties -> MarkdownContent`: the markdown
 * renderer renders frontmatter, and frontmatter only needed the renderer for
 * this pure predicate.
 *
 * Only the util that closes the cycle moved — `tableToMarkdown`, `tableToTsv`
 * and `isFencedBlockComplete` stay in `MarkdownContent.tsx`.
 *
 * See change: cleanup-import-cycles (D4a).
 */

/**
 * Returns true when `href` resolves to an origin different from the current
 * page (i.e. the link is external and clicking it would strand the user if it
 * replaced the dashboard view). Fragment-only refs (`#foo`), relative paths,
 * and absolute URLs matching `window.location.origin` are all considered
 * internal. Unparseable hrefs are treated as external so the anchor gets
 * `target="_blank"` — safer than silently navigating away.
 * See issue #13.
 */
export function isExternalHref(href: string | undefined): boolean {
  if (!href) return false; // bare <a> without href → leave alone
  if (href.startsWith("#")) return false; // fragment-only, same-document
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const resolved = new URL(href, base);
    return resolved.origin !== new URL(base).origin;
  } catch {
    return true;
  }
}
