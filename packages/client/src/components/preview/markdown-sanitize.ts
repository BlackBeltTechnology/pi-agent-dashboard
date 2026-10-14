/**
 * Sanitization policy for `MarkdownContent` (agent / file markdown is
 * untrusted: `rehype-raw` parses embedded HTML into the tree).
 *
 * Two cooperating layers, both lower-case-scheme only so they drop exactly
 * the same values:
 *  - `MARKDOWN_SCHEMA` — `rehype-sanitize` schema deciding which elements and
 *    attributes survive and which URL schemes each URL attribute admits.
 *  - `safeUrlTransform` — react-markdown `urlTransform` deciding which URL
 *    values survive on the final tree.
 *
 * See change: sanitize-untrusted-rendered-content.
 */
import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";

const defaultAttributes = defaultSchema.attributes ?? {};

/** Bare `id`/`name` allowed by the default schema enable DOM clobbering. */
const withoutBareIdName = (defaultAttributes["*"] ?? []).filter((entry) => {
  const key = Array.isArray(entry) ? entry[0] : entry;
  return key !== "id" && key !== "name";
});

/**
 * Entries REPLACE (never append to) the matching `defaultSchema` entries:
 * hast-util-sanitize returns the first matching attribute definition.
 */
export const MARKDOWN_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== "picture" && tag !== "source"),
  strip: [
    "script",
    "style",
    "object",
    "embed",
    "iframe",
    "svg",
    "math",
    "picture",
    "source",
    "noscript",
    "template",
    "textarea",
    "select",
  ],
  attributes: {
    ...defaultAttributes,
    // Only remark's already-prefixed footnote ids/names (plus the unprefixed
    // `footnote-label` that `aria-describedby` points at) survive.
    "*": [...withoutBareIdName, ["id", /^user-content-/, "footnote-label"], ["name", /^user-content-/]],
    // `math-*` classes are what remark-math emits for rehype-katex.
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  // remark already prefixes footnote ids; raw ids are dropped by the rule above.
  clobber: [],
  protocols: {
    ...defaultSchema.protocols,
    // The default href set is included so every scheme `defaultUrlTransform`
    // keeps on `img src` also survives the schema (parity; an `<img>` never
    // loads `mailto:` etc.). `data:` is narrowed to images by `safeUrlTransform`.
    src: [...(defaultSchema.protocols?.href ?? []), "data", "blob", "pi-asset"],
  },
};

/** Length of the scheme in `value`, or -1 when it is relative (no scheme). */
function schemeEnd(value: string): number {
  const colon = value.indexOf(":");
  if (colon === -1) return -1;
  for (const stop of ["/", "?", "#"]) {
    const at = value.indexOf(stop);
    if (at !== -1 && colon > at) return -1;
  }
  return colon;
}

/**
 * Keeps `pi-asset:` / `blob:` / `data:image/` on `img src` only; everything
 * else goes through react-markdown's `defaultUrlTransform`, then is dropped if
 * its scheme is not all lower-case (the schema compares case-sensitively).
 */
export const safeUrlTransform: UrlTransform = (value, key, node) => {
  if (
    node.tagName === "img" &&
    key === "src" &&
    (value.startsWith("pi-asset:") || value.startsWith("blob:") || value.startsWith("data:image/"))
  ) {
    return value;
  }
  const safe = defaultUrlTransform(value);
  const end = schemeEnd(safe);
  if (end !== -1) {
    const scheme = safe.slice(0, end);
    if (scheme !== scheme.toLowerCase()) return "";
  }
  return safe;
};
