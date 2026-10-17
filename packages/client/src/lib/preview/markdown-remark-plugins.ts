/**
 * The remark plugin list the dashboard's markdown renderer uses — one shared
 * constant so `MarkdownContent` and the apply-fix block locator parse a file
 * with the SAME grammar (frontmatter, math, GFM) and can never drift.
 * `rehypeRaw` is a rehype stage and irrelevant to mdast `code` nodes.
 *
 * See change: add-preview-apply-fix-to-file (design D3).
 */

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

export const MARKDOWN_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath, remarkFrontmatter];
