/**
 * Escape a value for use inside a double-quoted CSS attribute selector
 * (`[data-x="…"]`). `CSS.escape` is the right tool in a browser but is absent in
 * jsdom, and a quoted attribute value only needs `"` and `\` escaped.
 */
export function attrEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
