/**
 * Mermaid fence ordinals over an mdast tree.
 *
 * `collectMermaidCodeNodes` is the SINGLE definition of "the mermaid blocks of
 * a markdown file, in document order": fenced `code` nodes whose `lang` is
 * exactly `mermaid`. The renderer stamps each with its index
 * (`remarkMermaidOrdinal` → `data-mermaid-ordinal` on the rendered `<code>`),
 * and the apply-fix locator indexes the same list of a re-parsed file, so the
 * preview's block N is the file's block N by construction.
 *
 * See change: add-preview-apply-fix-to-file (design D1).
 */

/**
 * Per-page-load secret prefix of the stamp value. Raw HTML in untrusted markdown
 * (`<code data-mermaid-ordinal="0">`) survives the sanitizer's attribute allowlist,
 * but cannot carry a value starting with this unguessable nonce — so only a real
 * fence (stamped by `remarkMermaidOrdinal`) ever yields an ordinal.
 */
const NONCE =
  typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
    ? Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")
    : Math.random().toString(16).slice(2).padEnd(24, "0");

/** Regex source for the sanitizer allowlist (hex nonce + digits: no escaping needed). */
export const ORDINAL_STAMP_PATTERN = `^${NONCE}:\\d+$`;

/** Ordinal encoded in a stamp, or `undefined` for anything not produced by `remarkMermaidOrdinal`. */
export function parseOrdinalStamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.startsWith(`${NONCE}:`)) return undefined;
  const rest = value.slice(NONCE.length + 1);
  return /^\d+$/.test(rest) ? Number(rest) : undefined;
}

/** Minimal structural mdast node (avoids a direct `@types/mdast` dependency). */
export interface MdNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdNode[];
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } };
  data?: { hProperties?: Record<string, unknown>; [k: string]: unknown };
}

/** Fenced mermaid `code` nodes in document order (depth-first, pre-order). */
export function collectMermaidCodeNodes(root: MdNode): MdNode[] {
  const out: MdNode[] = [];
  const walk = (node: MdNode): void => {
    if (node.type === "code" && node.lang === "mermaid") out.push(node);
    if (node.children) for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

/** Remark plugin: stamps `dataMermaidOrdinal` (`<nonce>:<index>`) on every mermaid fence. */
export function remarkMermaidOrdinal() {
  return (tree: MdNode): void => {
    collectMermaidCodeNodes(tree).forEach((node, i) => {
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, dataMermaidOrdinal: `${NONCE}:${i}` },
      };
    });
  };
}
