/**
 * Strict frontmatter reader shared by templates and agent files: `---` fences, one YAML document
 * that must be a mapping, no aliases / anchors / merge keys / explicit tags, unique keys. Never
 * throws; every failure is a message the caller maps to its own error code.
 * See change: add-agent-teams-templates-hooks.
 */
import YAML from "yaml";

export type FrontmatterResult =
  | { ok: true; data: Record<string, unknown>; body: string; hasFrontmatter: boolean }
  | { ok: false; message: string };

const FENCE = /^---[ \t]*$/;

const MAX_FLOW_DEPTH = 64;
const MAX_INDENT = 256;

/** Cheap pre-parse bound on nesting (flow brackets, indentation) so a hostile file cannot cost memory or stack. */
function tooDeep(yamlText: string): boolean {
  if (yamlText.split("\n").some((line) => line.length - line.trimStart().length > MAX_INDENT)) return true;
  let depth = 0;
  let max = 0;
  for (const c of yamlText) {
    if (c === "[" || c === "{") max = Math.max(max, ++depth);
    else if ((c === "]" || c === "}") && depth > 0) depth--;
  }
  return max > MAX_FLOW_DEPTH;
}

/** Parse the YAML mapping text alone (no fences). */
export function parseYamlMapping(yamlText: string): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  if (tooDeep(yamlText)) return { ok: false, message: "frontmatter nesting is too deep" };
  try {
    const doc = YAML.parseDocument(yamlText, { uniqueKeys: true, strict: true, merge: false, schema: "core", version: "1.2" });
    if (doc.errors.length > 0) return { ok: false, message: doc.errors[0]?.message.split("\n")[0] ?? "invalid YAML" };
    let hazard: string | undefined;
    YAML.visit(doc, {
      Node(_key, node) {
        if (node.anchor) hazard ??= "anchors are not allowed";
        if (node.tag) hazard ??= `tags are not allowed (${node.tag})`;
      },
      Alias() {
        hazard ??= "aliases are not allowed";
      },
      Pair(_key, pair) {
        if (YAML.isScalar(pair.key) && pair.key.value === "<<") hazard ??= "merge keys are not allowed";
      },
    });
    if (hazard) return { ok: false, message: hazard };
    if (doc.contents === null) return { ok: true, data: {} };
    if (!YAML.isMap(doc.contents)) return { ok: false, message: "frontmatter must be a mapping" };
    const data = doc.toJS({ maxAliasCount: 0 }) as unknown;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, message: "frontmatter must be a mapping" };
    return { ok: true, data: data as Record<string, unknown> };
  } catch (err) {
    return { ok: false, message: `YAML could not be parsed: ${(err as Error).message.split("\n")[0]}` };
  }
}

/**
 * Split `text` into frontmatter and body. `required: true` fails when there is no opening fence
 * (templates); otherwise a file without fences is all body (agent files). A BOM and CRLF are accepted.
 */
export function splitFrontmatter(text: string, opts: { required: boolean }): FrontmatterResult {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n/);
  if (!FENCE.test(lines[0] ?? "")) {
    if (opts.required) return { ok: false, message: "frontmatter opening --- fence is missing" };
    return { ok: true, data: {}, body: lines.join("\n"), hasFrontmatter: false };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i] ?? "")) {
      close = i;
      break;
    }
  }
  if (close < 0) return { ok: false, message: "frontmatter closing --- fence is missing" };
  const parsed = parseYamlMapping(lines.slice(1, close).join("\n"));
  if (!parsed.ok) return parsed;
  return { ok: true, data: parsed.data, body: lines.slice(close + 1).join("\n"), hasFrontmatter: true };
}
