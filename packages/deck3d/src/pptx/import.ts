/**
 * `deck3d pptx import` orchestrator (spec deck3d-pptx-import): guarded zip →
 * extraction → slide ids (re-import matching) → reference renders → visible
 * fallbacks → `layout.json` + media + baseline `deck.md`/`deck.json`, all
 * staged and committed atomically.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, resolve } from "node:path";
import type { Sandbox } from "../art/decode.js";
import { encodePng } from "../art/png.js";
import type { DeckIR } from "../ir/types.js";
import { formatIssue, type ValidationIssue, validate, validateAssets } from "../ir/validate.js";
import { withStyleLockAsync } from "../variants/style.js";
import {
  type AssetEntry,
  baselineDeckOverrides,
  baselineMarkdown,
  baselineMode,
  importedAssets,
  matchSlideIds,
  reconcileAssets,
} from "./baseline.js";
import { extractPptx, finalizeLayout, stableStringify } from "./extract.js";
import { applyFallbacks, pngDecoder } from "./fallback.js";
import { sha256Hex } from "./media.js";
import { refFromDir, refFromLibreOffice } from "./ref.js";
import { defaultWrite, type RenameFn, Stage, type WriteFn } from "./stage.js";
import { type Layout, PptxImportError } from "./types.js";
import { readPptxZip } from "./zip.js";

export interface ImportOptions {
  input: string;
  out?: string;
  ref?: string;
  force?: boolean;
  /** Environment used to find `soffice`/`pdftoppm` (tests strip PATH). */
  env?: NodeJS.ProcessEnv;
  /** Write hook (fault injection in tests). */
  write?: WriteFn;
  /** Rename hook used by the commit (fault injection in tests). */
  rename?: RenameFn;
  /** Sandbox factory; resolves undefined when chromium is unavailable. */
  sandbox?: () => Promise<Sandbox | undefined>;
}

export interface ImportResult {
  dir: string;
  slides: string[];
  warnings: string[];
}

/** Top-level entries a commit replaces wholesale (see `Stage.commit`). */
const REPLACED = new Set(["pptx", "deck.md", "deck.json", "deck.json.bak"]);

/**
 * Carry user-owned asset files that live INSIDE a replaced entry (e.g.
 * `pptx/custom/logo.png`) into the staged tree, so the directory swap does
 * not delete them. A user file whose path an imported file also claims, with
 * different content, is a conflict: refuse rather than overwrite either.
 */
function preserveUserFiles(assets: AssetEntry[] | undefined, existingDir: string, stage: Stage): void {
  for (const a of assets ?? []) {
    if (a.id.startsWith("pptx-")) continue;
    const rel = posix.normalize(a.path.replace(/\\/g, "/"));
    if (rel.startsWith("..") || posix.isAbsolute(rel) || !REPLACED.has(rel.split("/")[0])) continue;
    const src = join(existingDir, rel);
    if (!existsSync(src)) continue; // `validate` reports a missing file
    const staged = join(stage.dir, rel);
    const bytes = readFileSync(src);
    if (existsSync(staged)) {
      if (!readFileSync(staged).equals(bytes)) {
        throw new PptxImportError(`user asset '${a.id}' at '${a.path}' collides with an imported file; move it outside pptx/`);
      }
      continue;
    }
    stage.file(rel, bytes);
  }
}

/**
 * Validate the generated deck. User-owned references (assets without the
 * `pptx-` prefix, `local:` effects) live in the EXISTING deck directory and
 * survive the import untouched, so they resolve there; the imported `pptx-`
 * assets exist only in staging and are checked against it. A fresh import has
 * no existing directory, so staging resolves everything.
 */
export function validateGenerated(ir: DeckIR, stageDir: string, targetDir: string): ValidationIssue[] {
  if (!existsSync(targetDir)) return validate(ir, { deckDir: stageDir }).errors;
  const assets = ir.overrides.assets ?? [];
  const imported = assets.map((a, i) => ({ a, i })).filter(({ a }) => a.id.startsWith("pptx-"));
  const importedIdx = new Set(imported.map(({ i }) => i));
  const errors = validate(ir, { deckDir: targetDir }).errors.filter((e) => {
    const m = /^overrides\.assets\[(\d+)\]/.exec(e.path);
    return !(m && importedIdx.has(Number(m[1])));
  });
  const own = validateAssets({ ...ir, overrides: { ...ir.overrides, assets: imported.map(({ a }) => a) } }, stageDir);
  for (const e of own) {
    const k = Number(/^overrides\.assets\[(\d+)\]/.exec(e.path)?.[1]);
    errors.push({ ...e, path: e.path.replace(/^overrides\.assets\[\d+\]/, `overrides.assets[${imported[k]?.i ?? k}]`) });
  }
  return errors;
}

async function defaultSandbox(): Promise<Sandbox | undefined> {
  try {
    const { openSandbox } = await import("../art/decode.js");
    return await openSandbox();
  } catch {
    return undefined;
  }
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function importPptx(opts: ImportOptions): Promise<ImportResult> {
  const input = resolve(opts.input);
  const dir = resolve(opts.out ?? join(dirname(input), basename(input, extname(input))));
  // A re-import READS the previous deck.json (to keep its overrides) and later
  // replaces it, so it holds the same deck lock as `variants pick|note|replay` and
  // `serve` from that read to the commit: a pick landing in between would be lost.
  if (opts.force && existsSync(dir)) {
    return withStyleLockAsync(dir, () => runImport(opts, input, dir), { waitMs: Number(process.env.DECK3D_LOCK_WAIT_MS ?? 10_000) });
  }
  return runImport(opts, input, dir);
}

async function runImport(opts: ImportOptions, input: string, dir: string): Promise<ImportResult> {
  if (!opts.force) {
    for (const name of ["deck.md", "deck.json"]) {
      const p = join(dir, name);
      if (existsSync(p)) throw new PptxImportError(`${p} already exists (pass --force to re-import and keep its overrides)`);
    }
  }
  if (!existsSync(input)) throw new PptxImportError(`missing input ${input}`);

  const files = readPptxZip(new Uint8Array(readFileSync(input)));
  const ex = extractPptx(files);
  if (!ex.slides.length) throw new PptxImportError("the presentation has no slides");

  const warnings: string[] = [];
  const prevLayout = opts.force ? readJson<Layout>(join(dir, "pptx", "layout.json")) : undefined;
  const prevDeckRaw = opts.force && existsSync(join(dir, "deck.json")) ? readFileSync(join(dir, "deck.json"), "utf8") : undefined;
  const prevDeck = prevDeckRaw ? (JSON.parse(prevDeckRaw) as DeckIR) : undefined;

  const match = matchSlideIds(ex.slides, prevLayout?.slides);
  warnings.push(...match.warnings);
  const { layout, fallbacks } = finalizeLayout(ex, match.ids);

  // The sandbox is opened lazily: only JPEG exports and exotic PNGs need it.
  let sandbox: Sandbox | undefined;
  let sandboxTried = false;
  const getSandbox = async (): Promise<Sandbox | undefined> => {
    if (!sandboxTried) {
      sandboxTried = true;
      sandbox = await (opts.sandbox ?? defaultSandbox)();
    }
    return sandbox;
  };
  const stage = new Stage(dir, opts.write ?? defaultWrite, opts.rename);
  try {
    const refs = opts.ref
      ? await refFromDir(opts.ref, ex.slides.length, async (bytes) => {
          const sb = await getSandbox();
          if (!sb) return undefined;
          const { sniffMime } = await import("../art/decode.js");
          return encodePng(await sb.decode(bytes, sniffMime(bytes)));
        })
      : refFromLibreOffice(input, ex.slides.length, opts.env);
    warnings.push(...refs.warnings);
    const refById = new Map<string, Uint8Array>();
    for (const [n, png] of refs.images) refById.set(match.ids[n - 1], png);

    const decode = pngDecoder(async (bytes) => {
      const sb = await getSandbox();
      if (!sb) throw new PptxImportError("a reference render needs chromium to decode (npx playwright install chromium)");
      return sb.decode(bytes, "image/png");
    });
    warnings.push(...(await applyFallbacks(fallbacks, refById, layout.size.w, ex.media, decode)));

    const layoutJson = stableStringify(layout);
    stage.file("pptx/layout.json", layoutJson);
    const media = ex.media.files();
    for (const m of media) stage.file(`pptx/media/${m.name}`, m.bytes);
    for (const [id, png] of [...refById.entries()].sort()) stage.file(`pptx/ref/${id}.png`, png);

    const md = baselineMarkdown(ex.slides.map((s, i) => ({ id: match.ids[i], title: s.title, drafts: s.drafts })));
    stage.file("deck.md", md);

    const { parseDeck } = await import("../parse/derive.js");
    const { defaultEffectsFor, defaultSceneFor } = await import("../fx/defaults.js");
    const { ir, warnings: parseWarnings } = await parseDeck(md, {
      source: "deck.md",
      ...(prevDeck ? { previous: prevDeck } : {}),
      effectsForSlide: (slide, autoStyle) => defaultEffectsFor(slide, autoStyle),
      sceneForSlide: (slide, autoStyle) => defaultSceneFor(slide, autoStyle),
    });
    warnings.push(...parseWarnings.map((w) => (w.startsWith("warn") ? w : `warning ${w}`)));

    const overrides = ir.overrides as Record<string, unknown> & { deck?: Record<string, unknown>; assets?: AssetEntry[] };
    const deckOv: Record<string, unknown> = { ...(overrides.deck ?? {}) };
    for (const [k, v] of Object.entries(baselineDeckOverrides(layout.theme, baselineMode(layout)))) {
      if (deckOv[k] === undefined) deckOv[k] = v;
    }
    overrides.deck = deckOv;
    const rec = reconcileAssets(prevDeck?.overrides.assets as AssetEntry[] | undefined, importedAssets(ex.media.assetEntries(), sha256Hex(layoutJson)), overrides);
    if (rec.dangling.length) throw new PptxImportError(`re-import would drop referenced assets: ${rec.dangling.join("; ")}`);
    warnings.push(...rec.warnings);
    overrides.assets = rec.assets;

    preserveUserFiles(overrides.assets, dir, stage);
    // A bad import never lands: the deck must validate before anything is committed.
    const problems = validateGenerated(ir, stage.dir, dir);
    if (problems.length) throw new PptxImportError(`generated deck failed validation: ${problems.map((e) => formatIssue("error", e)).join("; ")}`);
    stage.file("deck.json", `${JSON.stringify(ir, null, 2)}\n`);
    if (prevDeckRaw !== undefined) stage.file("deck.json.bak", prevDeckRaw);
    stage.commit(["pptx", "deck.md", "deck.json", "deck.json.bak"]);
  } catch (err) {
    stage.discard();
    throw err;
  } finally {
    await sandbox?.close();
  }
  return { dir, slides: match.ids, warnings };
}
