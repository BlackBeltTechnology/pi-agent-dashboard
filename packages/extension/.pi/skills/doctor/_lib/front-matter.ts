/**
 * Minimal front-matter parser for doctor capability modules.
 *
 * Each capability MD opens with a `---`-delimited block declaring the router
 * contract keys: `name`, `scope`, `symptoms:` (phrases), `depends-on:` (module
 * ids), and `derives-from:` (live sources of truth). The router derives its
 * symptom map and sweep DAG from these keys alone, so the parser only supports
 * the subset actually used: string scalars and single-level string lists
 * (block `- item` or inline `[a, b]`).
 *
 * See change: add-modular-doctor-skill (design.md D1/D2).
 */

export interface ModuleFrontMatter {
	/** Module id (defaults to the MD basename when `name` is absent). */
	name: string;
	/** One-sentence scope declaration. */
	scope: string;
	/** Symptom phrases routed to this module. */
	symptoms: string[];
	/** Module ids this module depends on (defines the sweep DAG). */
	dependsOn: string[];
	/** Live sources of truth this module derives from. */
	derivesFrom: string[];
}

function stripQuotes(raw: string): string {
	const t = raw.trim();
	if (
		(t.startsWith('"') && t.endsWith('"')) ||
		(t.startsWith("'") && t.endsWith("'"))
	) {
		return t.slice(1, -1);
	}
	return t;
}

function parseInlineList(raw: string): string[] {
	const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
	if (!inner.trim()) return [];
	return inner
		.split(",")
		.map((s) => stripQuotes(s))
		.filter((s) => s.length > 0);
}

/**
 * Extract the raw front-matter block (between the first two `---` fences).
 * Returns null when the document has no front-matter.
 */
export function extractFrontMatterBlock(md: string): string | null {
	const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return m ? m[1] : null;
}

type ListKey = "symptoms" | "dependsOn" | "derivesFrom";

const LIST_KEYS: Record<string, ListKey> = {
	symptoms: "symptoms",
	"depends-on": "dependsOn",
	"derives-from": "derivesFrom",
};

/** Append a block-list continuation (`  - item`) to the active list, if any. */
function handleListItem(fm: ModuleFrontMatter, line: string, active: ListKey | null): boolean {
	const m = line.match(/^\s+-\s+(.*)$/);
	if (!m || !active) return false;
	const val = stripQuotes(m[1]);
	if (val) fm[active].push(val);
	return true;
}

/**
 * Apply a `key: rest` line to the accumulator and return the next active list
 * key (non-null when a block list was opened, so following `- item` lines
 * append to it).
 */
function applyKeyLine(
	fm: ModuleFrontMatter,
	key: string,
	rest: string,
	fallbackName: string,
): ListKey | null {
	const listKey = LIST_KEYS[key];
	if (listKey) {
		if (rest.trim().startsWith("[")) {
			fm[listKey] = parseInlineList(rest);
			return null;
		}
		return listKey;
	}
	if (key === "name") fm.name = stripQuotes(rest) || fallbackName;
	else if (key === "scope") fm.scope = stripQuotes(rest);
	return null;
}

/**
 * Parse a capability module's front-matter into the router contract shape.
 * `fallbackName` (the file basename) is used when `name:` is absent.
 */
export function parseFrontMatter(md: string, fallbackName: string): ModuleFrontMatter {
	const fm: ModuleFrontMatter = {
		name: fallbackName,
		scope: "",
		symptoms: [],
		dependsOn: [],
		derivesFrom: [],
	};
	const block = extractFrontMatterBlock(md);
	if (!block) return fm;

	let active: ListKey | null = null;
	for (const line of block.split(/\r?\n/)) {
		if (!line.trim()) continue;
		if (handleListItem(fm, line, active)) continue;
		const kv = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
		if (!kv) continue;
		active = applyKeyLine(fm, kv[1].toLowerCase(), kv[2], fallbackName);
	}

	return fm;
}
