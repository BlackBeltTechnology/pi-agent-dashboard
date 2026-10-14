/**
 * Extract command ids from an app's command-list output (`commands`, `commands --json`, `tools`):
 * a JSON array of `{id|name, aliases?}` rows, or a text table whose first token per unindented line is the id.
 * Shared by `scripts/record-fixtures.mjs` and the nightly drift test against real binaries.
 *
 * See change: add-craft-apps-core (skill drift check).
 */
export function extractCommandIds(text: string): string[] {
  const out = new Set<string>();
  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : (((parsed as { tools?: unknown[]; commands?: unknown[] }).tools ?? (parsed as { commands?: unknown[] }).commands ?? []) as unknown[]);
    for (const row of rows as { id?: unknown; name?: unknown; aliases?: unknown }[]) {
      const id = row.id ?? row.name;
      if (typeof id === "string") out.add(id);
      if (Array.isArray(row.aliases)) for (const alias of row.aliases) if (typeof alias === "string") out.add(alias);
    }
    return [...out].sort();
  } catch {
    for (const line of text.split("\n")) {
      const m = /^([A-Za-z][\w-]*(?:\.[\w-]+)+)\*?\s/.exec(line);
      if (m) out.add(m[1]);
    }
    return [...out].sort();
  }
}
