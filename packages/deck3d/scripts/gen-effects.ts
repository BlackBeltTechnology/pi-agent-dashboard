/**
 * Generate `reference/effects.md` from the effect cards.
 * Run by `npm run gen:effects` (wired into package `build`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCatalogue } from "../src/fx/catalogue.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".pi", "skills", "deck3d", "reference", "effects.md");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderCatalogue());
console.log(`wrote ${out}`);
