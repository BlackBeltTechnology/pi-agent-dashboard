/**
 * Stable id derivation. Ids must come from author-written source (slide titles,
 * mermaid node names, message order) — never from render-time counters — so a
 * re-parse is byte-identical and overrides survive.
 */

export const SLIDE_ID_PATTERN = /^(?!deck3d-)[a-z0-9-]+$/;

/** Latin-1/Latin-Extended fold: strip combining marks (`ő` → `o`, `ű` → `u`). */
export function foldAscii(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Slugify a title into an id: ASCII-folded, lowercased, non-alphanumerics
 * collapsed to `-`. An empty result becomes `slide` (design D1).
 */
export function slugify(input: string): string {
  const base = foldAscii(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const id = base || "slide";
  // `deck3d-` is reserved for generated slides (e.g. the credits slide).
  return id.startsWith("deck3d-") ? `s-${id}` : id;
}

/** Split `# Title {#pin}` into its display title and optional pinned id. */
export function parseHeading(raw: string): { title: string; pin?: string } {
  const m = /^(.*?)\s*\{#([a-z0-9-]+)\}\s*$/.exec(raw.trim());
  if (m) return { title: m[1].trim(), pin: slugify(m[2]) };
  return { title: raw.trim() };
}

/** Assign slide ids in order, adding `-<ordinal>` on collision (design D1). */
export function assignSlideIds(entries: Array<{ title: string; pin?: string }>): string[] {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return entries.map((e) => {
    let id = e.pin ?? slugify(e.title);
    if (used.has(id)) {
      const base = id;
      let n = counts.get(base) ?? 1;
      let candidate: string;
      do {
        n += 1;
        candidate = `${base}-${n}`;
      } while (used.has(candidate));
      counts.set(base, n);
      id = candidate;
    }
    used.add(id);
    return id;
  });
}

/** `<from>-><to>#<k>` with `k` the ordinal among parallel edges in source order. */
export function edgeId(from: string, to: string, ordinal: number): string {
  return `${from}->${to}#${ordinal}`;
}

/** `m<index>` message id. */
export function messageId(index: number): string {
  return `m${index}`;
}
