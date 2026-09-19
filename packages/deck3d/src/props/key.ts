/**
 * Prop cache key — `<source>-<id>`, slug-only (never URL-derived), shared by
 * fetch, embed, generate and the browser runtime so all four agree on the file
 * name and the `window.__DECK_PROPS` map key. No Node imports (bundled into the
 * runtime).
 */
export function propSlug(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-");
}

export function propKey(prop: { source: string; id: string }): string {
  return `${propSlug(prop.source)}-${propSlug(prop.id)}`;
}
