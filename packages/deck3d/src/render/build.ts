/**
 * IR → `deck.html` (the body of `deck3d render`), usable with an in-memory IR:
 * `variants render` and `serve ?variant=` render a deck with a candidate
 * fragment merged in without touching `deck.json`. Lives here, not in
 * `cli.ts`, so `variants/` and `serve/` never import the CLI (see `cli-io.ts`).
 *
 * Callers validate first. Returns `undefined` after reporting on `io` when a
 * param is out of range or two effects conflict.
 */
import { basename } from "node:path";
import type { CliIO } from "../cli-io.js";
import type { DeckIR } from "../ir/types.js";

export interface RenderIrOptions {
  embedVideo?: boolean;
}

export async function renderIrToHtml(ir: DeckIR, jsonPath: string, io: CliIO, opts: RenderIrOptions = {}): Promise<string | undefined> {
  const { composeEffects, validateEffectParams } = await import("../fx/compose.js");
  const { ensureRuntime, renderDeck, fontBase64, loadLocalEffects } = await import("./index.js");
  // Resolve the local effects first: their cards take part in param bounds,
  // conflict, mode and budget gating exactly like corpus cards.
  const localFx = loadLocalEffects(ir, jsonPath);
  const localCards = Object.fromEntries(
    Object.entries(localFx).map(([name, m]) => [name, m.card as import("../fx/types.js").FxCard]),
  );
  const violations = validateEffectParams(ir, localCards);
  if (violations.length) {
    for (const v of violations) io.stderr(`error ${v.path}: ${v.message}`);
    return undefined;
  }
  // Compose the MERGED view: `overrides.effects` + `overrides.slides[id].effects`
  // are already folded into each slide's effective list by `applyOverrides`.
  const { applyOverrides } = await import("../ir/merge.js");
  const merged = applyOverrides(ir);
  for (const slide of merged.slides) {
    const ov = ir.overrides.slides?.[slide.id];
    const mode = ov?.mode ?? ir.overrides.deck?.mode ?? ir.defaults.mode ?? "dark";
    const quality = ov?.quality ?? ir.overrides.deck?.quality ?? ir.defaults.quality ?? "high";
    const comp = composeEffects(slide.effects, mode, quality, slide.id, localCards);
    for (const warning of comp.warnings) io.stderr(warning);
    if (comp.conflicts.length) {
      for (const c of comp.conflicts) io.stderr(`error conflict ${c}`);
      return undefined;
    }
  }
  const { loadProps } = await import("../props/embed.js");
  const runtime = await ensureRuntime();
  const props = loadProps(ir, jsonPath);
  // `--embed-video` inlines clips as `data:` URLs so the html stays ONE file.
  // Without it the clip is fetched relative to the page, which `deck3d serve`
  // answers from its asset route.
  let renderIr = ir;
  if (opts.embedVideo) {
    const { embedVideo } = await import("./embed-video.js");
    const result = embedVideo(ir, jsonPath);
    for (const w of result.warnings) io.stderr(`warning ${w}`);
    const total = Object.values(result.embedded).reduce((a, b) => a + b, 0);
    if (total) io.stdout(`embedded ${Object.keys(result.embedded).length} clip(s), ${(total / 1024 / 1024).toFixed(1)} MiB`);
    renderIr = result.ir;
  }
  const { loadAssets, AssetBudgetError } = await import("./assets.js");
  let bundle: ReturnType<typeof loadAssets>;
  try {
    bundle = loadAssets(ir, jsonPath);
  } catch (err) {
    if (err instanceof AssetBudgetError) {
      io.stderr(`error ${err.message}`);
      return undefined;
    }
    throw err;
  }
  for (const w of bundle.warnings) io.stderr(w);
  return renderDeck(renderIr, { runtime, font: fontBase64(), title: basename(jsonPath, ".json"), props, localFx, assets: bundle.assets });
}
