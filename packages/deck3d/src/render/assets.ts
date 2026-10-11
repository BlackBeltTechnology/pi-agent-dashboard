/**
 * Deck asset bundle → embedded `data:` URIs (spec deck3d-slide-layers "Deck
 * asset bundle", design D3). Every `overrides.assets` entry is embedded once,
 * in ascending id order, so the HTML is byte-identical whatever the order of
 * entries in `deck.json`. Sizes are budgeted from `stat` BEFORE any file is
 * read: warn above 25 MiB, refuse above 200 MiB.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DeckIR } from "../ir/types.js";

export const ASSET_WARN_BYTES = 25 * 1024 * 1024;
export const ASSET_MAX_BYTES = 200 * 1024 * 1024;

export interface EmbeddedAsset {
  id: string;
  mime: string;
  /** `data:<mime>;base64,…` */
  data: string;
}

export interface AssetBundle {
  assets: EmbeddedAsset[];
  total: number;
  warnings: string[];
}

export class AssetBudgetError extends Error {
  constructor(total: number) {
    super(`overrides.assets total ${total} bytes exceeds the ${ASSET_MAX_BYTES / 1024 / 1024} MiB limit; no HTML written`);
    this.name = "AssetBudgetError";
  }
}

/** Embed `entries` (paths relative to `baseDir`), sorted by id, under the size budget. */
export function embedFiles(entries: Array<{ id: string; path: string; mime: string }>, baseDir: string): AssetBundle {
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = sorted.reduce((sum, a) => sum + statSync(resolve(baseDir, a.path)).size, 0);
  if (total > ASSET_MAX_BYTES) throw new AssetBudgetError(total);
  const warnings = total > ASSET_WARN_BYTES ? [`warning overrides.assets total ${total} bytes exceeds ${ASSET_WARN_BYTES / 1024 / 1024} MiB (deck.html grows by ~4/3 of that)`] : [];
  const assets = sorted.map((a) => ({
    id: a.id,
    mime: a.mime,
    data: `data:${a.mime};base64,${readFileSync(resolve(baseDir, a.path)).toString("base64")}`,
  }));
  return { assets, total, warnings };
}

/** Read and encode the deck's assets (paths already validated by `validate`). */
export function loadAssets(ir: DeckIR, jsonPath: string): AssetBundle {
  return embedFiles(ir.overrides.assets ?? [], dirname(jsonPath));
}
