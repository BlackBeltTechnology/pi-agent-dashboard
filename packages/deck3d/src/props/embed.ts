/**
 * Prop embedding + automatic credits (design D7).
 *
 * `loadProps` resolves every *placeable* `overrides.props[]` entry from the
 * `.deck3d/props/<source>-<id>.glb` cache beside the deck, verifies its pinned
 * sha256, and returns a `{ key: base64 }` map for the runtime. Any missing or
 * tampered cache file is a hard failure naming the prop and the fetch remedy —
 * the caller writes no HTML.
 *
 * A prop is *placeable* only when its role can be rendered: the slide exists
 * and, for `node:<id>`, the node exists on that slide. A dangling node role is
 * a validate warning (kept, inert), so its cache file is not required and the
 * prop is absent from the embedded map (E29).
 *
 * `creditsSlide` derives the attribution slide for any prop whose licence is
 * not CC0 and not `generated`; it is appended to the *merged* view at render
 * time, so `deck.json` never contains it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyOverrides } from "../ir/merge.js";
import type { DeckIR, MergedDeck, PropOverride, Slide } from "../ir/types.js";
import { sha256 } from "./fetch.js";
import { propKey } from "./key.js";

export class PropEmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropEmbedError";
  }
}

/** `generated` and CC0 props need no attribution; everything else does. */
export function requiresAttribution(licence: string): boolean {
  const l = licence.trim().toLowerCase();
  return l !== "generated" && !l.startsWith("cc0");
}

/** Props whose role resolves on the merged deck (dangling node roles are inert). */
export function activeProps(deck: MergedDeck): PropOverride[] {
  return (deck.props ?? []).filter((prop) => {
    const slide = deck.slides.find((s) => s.id === prop.slide);
    if (!slide) return false;
    if (!prop.role.startsWith("node:")) return true;
    const nodeId = prop.role.slice("node:".length);
    return Boolean(slide.diagram.nodes?.some((n) => n.id === nodeId));
  });
}

/** Last slide of the deck: the attribution list, or `null` when none is owed. */
export function creditsSlide(props: PropOverride[], index: number): Slide | null {
  const cited = props.filter((p) => requiresAttribution(p.licence));
  if (!cited.length) return null;
  return {
    index,
    id: "credits",
    kind: "credits",
    title: "Credits",
    subtitle: "Model attribution",
    bullets: cited.map((p) => {
      const base = `${p.id} — ${p.author} (${p.source}, ${p.licence})`;
      return p.restyle === "palette" ? `${base}, modified: restyled` : base;
    }),
    scene: "tokens",
    diagram: { kind: "none" },
  };
}

/** `{ "<source>-<id>": base64 }` for every placeable prop; throws on a bad cache. */
export function loadProps(ir: DeckIR, jsonFile: string): Record<string, string> {
  const deck = applyOverrides(ir);
  const dir = join(dirname(jsonFile), ".deck3d", "props");
  const out: Record<string, string> = {};
  for (const prop of activeProps(deck)) {
    const key = propKey(prop);
    const file = join(dir, `${key}.glb`);
    if (!existsSync(file)) {
      throw new PropEmbedError(
        `prop '${prop.id}' is not cached (${file}) — run \`deck3d props fetch ${prop.source} ${prop.id}\``,
      );
    }
    const bytes = new Uint8Array(readFileSync(file));
    const hash = sha256(bytes);
    if (hash !== prop.sha256) {
      throw new PropEmbedError(
        `prop '${prop.id}' sha256 ${hash} ≠ pinned ${prop.sha256} — re-run \`deck3d props fetch ${prop.source} ${prop.id}\``,
      );
    }
    out[key] = Buffer.from(bytes).toString("base64");
  }
  return out;
}
