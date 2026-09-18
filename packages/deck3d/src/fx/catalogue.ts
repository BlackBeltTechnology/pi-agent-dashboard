/**
 * Effect catalogue — the single Markdown source of truth (`reference/effects.md`)
 * generated from the cards, plus a hash the corpus test compares.
 */
import { createHash } from "node:crypto";
import { REGISTRY } from "./index.js";
import type { FxCard } from "./types.js";

export interface CatalogueEntry {
  id: string;
  kind: FxCard["kind"];
  cost: number;
  modes: FxCard["modes"];
  mood: string[];
  content: string[];
  source: string;
  licence: string;
  params: string;
}

/** Sorted catalogue rows (id order) for `fx list` and the generated doc. */
export function catalogue(): CatalogueEntry[] {
  return Object.values(REGISTRY)
    .map(({ card }) => ({
      id: card.id,
      kind: card.kind,
      cost: card.cost,
      modes: card.modes,
      mood: card.tags.mood,
      content: card.tags.content,
      source: card.source,
      licence: card.licence,
      params: Object.keys(card.params).sort().join(", "),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Stable hash of every card (catalogue drift detector). */
export function catalogueHash(): string {
  const canonical = Object.values(REGISTRY)
    .map(({ card }) => JSON.stringify(card))
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function paramTable(card: FxCard): string {
  const rows = Object.entries(card.params).map(([name, schema]) => {
    const s = schema as { type?: string; default?: unknown; minimum?: number; maximum?: number };
    const range = s.minimum !== undefined || s.maximum !== undefined ? `${s.minimum ?? ""}..${s.maximum ?? ""}` : "—";
    return `| ${name} | ${s.type ?? ""} | ${range} | ${s.default ?? ""} |`;
  });
  if (!rows.length) return "No parameters.";
  return ["| Param | Type | Range | Default |", "|---|---|---|---|", ...rows].join("\n");
}

/** `reference/effects.md` body. */
export function renderCatalogue(): string {
  const hash = catalogueHash();
  const out: string[] = [
    "# deck3d effect catalogue",
    "",
    `GENERATED from the effect cards (\`fx/<id>.meta.json\`). Never hand-edit. Cards hash: \`${hash}\`.`,
    "",
    `${Object.keys(REGISTRY).length} effects.`,
    "",
  ];
  for (const card of Object.values(REGISTRY)
    .map((e) => e.card)
    .sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(
      `## ${card.id}`,
      "",
      `- kind: \`${card.kind}\``,
      `- cost: ${card.cost}`,
      `- modes: \`${card.modes}\``,
      `- tags: mood=[${card.tags.mood.join(", ")}] content=[${card.tags.content.join(", ")}]`,
      `- source: ${card.source}`,
      `- licence: ${card.licence}`,
      `- preview: \`fx/previews/${card.id}.png\``,
      "",
      paramTable(card),
      "",
    );
  }
  return `${out.join("\n")}`;
}
