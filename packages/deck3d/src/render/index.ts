/**
 * Renderer — `deck.html` = fixed template + inlined esbuild runtime + inlined
 * canonical-IR JSON + base64 Poppins TTF (design D3).
 *
 * Determinism: the runtime bundle is built once at package build (fixed
 * options, no hashes), the IR is serialised with sorted keys, the font is the
 * vendored constant. Same inputs ⇒ byte-identical output. No dates, no random.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import opentype from "opentype.js";
import { canonicalJson } from "../ir/hash.js";
import { localRefs, resolveLocalEffect, toFactorySource } from "../fx/local.js";
import { applyOverrides } from "../ir/merge.js";
import type { DeckIR } from "../ir/types.js";
import { activeProps, creditsSlide } from "../props/embed.js";
import { pkgRoot } from "../util/paths.js";
import { glyphText, subsetFont } from "./font.js";

/** Package root — correct both unbundled (src) and bundled (`dist/cli.js`). */
const ROOT = pkgRoot();

export const RUNTIME_PATH = join(ROOT, "dist", "runtime.js");
export const TEMPLATE_PATH = join(ROOT, "src", "render", "template.html");
export const FONT_PATH = join(ROOT, "assets", "Poppins-Bold.ttf");

export function runtimeSource(path = RUNTIME_PATH): string {
  return readFileSync(path, "utf8");
}

/** The runtime bundle, built on demand when `dist/runtime.js` is absent (dev/CI). */
export async function ensureRuntime(): Promise<string> {
  if (existsSync(RUNTIME_PATH)) return runtimeSource();
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [join(ROOT, "src", "runtime", "index.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  mkdirSync(dirname(RUNTIME_PATH), { recursive: true });
  writeFileSync(RUNTIME_PATH, code);
  return code;
}

export function fontBase64(path = FONT_PATH): string {
  return readFileSync(path).toString("base64");
}

/** Full TTF parsed, then subset to `text` and base64-encoded (deterministic). */
export function subsetFontBase64(text: string, path = FONT_PATH): string {
  const bytes = new Uint8Array(readFileSync(path));
  const font = opentype.parse(bytes.buffer);
  return Buffer.from(subsetFont(font, text)).toString("base64");
}

/** Dotted leaf paths of an override object (`camera.distance`, `mode`). */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return prefix ? [prefix.slice(0, -1)] : [];
  return Object.entries(obj).flatMap(([k, v]) => leafPaths(v, `${prefix}${k}.`));
}

/** Which merged values came from `overrides`, for the configurator's markers. */
function overriddenKeys(ir: DeckIR): { deck: string[]; slides: Record<string, string[]> } {
  const slides: Record<string, string[]> = {};
  for (const [id, entry] of Object.entries(ir.overrides.slides ?? {})) slides[id] = leafPaths(entry);
  return { deck: leafPaths(ir.overrides.deck ?? {}), slides };
}

/** JSON safe to inline in a `<script>`: sorted keys, `<`/U+2028/U+2029 escaped. */
export function jsonForScript(value: unknown): string {
  return canonicalJson(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface RenderOptions {
  title?: string;
  runtime?: string;
  font?: string;
  template?: string;
  /** Base64 GLB bytes keyed `<source>-<id>` (from `loadProps`). */
  props?: Record<string, string>;
  /** Local effect sources + cards keyed by `<name>` (from `loadLocalEffects`). */
  localFx?: Record<string, { card: unknown; src: string }>;
}

/**
 * Resolve every `local:` reference to `{ card, src }`, re-checking hash, card
 * and lint. Throws on the first failure: `render` must not write HTML around a
 * module whose bytes no longer match the pin.
 */
export function loadLocalEffects(ir: DeckIR, jsonPath: string): Record<string, { card: unknown; src: string }> {
  const deckDir = dirname(jsonPath);
  const out: Record<string, { card: unknown; src: string }> = {};
  for (const { ref, path } of localRefs(ir.overrides)) {
    const { effect, issues } = resolveLocalEffect(ref, deckDir);
    if (!effect) throw new Error(`${path}${issues[0]?.suffix ?? ""}: ${issues[0]?.message ?? "unresolved local effect"}`);
    out[effect.name] = { card: effect.card, src: toFactorySource(effect.src) };
  }
  return out;
}

/**
 * Replace every template token in ONE pass over the original template, so a
 * substituted value that itself contains a later token is never rescanned
 * (e.g. a slide documenting deck3d's own `__FONT__` placeholder).
 */
function substituteTokens(template: string, values: Record<string, string>): string {
  return template.replace(/__(?:DECK_LOCAL_FX|DECK_PROPS|DECK|FONT|RUNTIME|TITLE)__/g, (token) => values[token] ?? token);
}

/** Deck IR → self-contained `deck.html` string. */
export function renderDeck(ir: DeckIR, opts: RenderOptions = {}): string {
  const merged = applyOverrides(ir);
  merged.overriddenKeys = overriddenKeys(ir);
  // The panel keys its stored state per deck; without this every deck would
  // share one `deck3d:` entry.
  if (ir.meta.derivedHash) merged.derivedHash = ir.meta.derivedHash;
  // Only placeable props are embedded; a dangling `node:<id>` role is inert.
  const props = activeProps(merged);
  merged.props = props;
  const credits = creditsSlide(props, merged.slides.length);
  if (credits) merged.slides.push(credits);
  const template = opts.template ?? readFileSync(TEMPLATE_PATH, "utf8");
  const runtime = opts.runtime ?? runtimeSource();
  const font = opts.font ?? subsetFontBase64(glyphText(merged));
  const title = opts.title ?? merged.slides[0]?.title ?? "deck3d";
  const deckJson = jsonForScript(merged);
  const propsJson = jsonForScript(opts.props ?? {});
  // `jsonForScript` escapes `<`, so a `</script>` inside a module source cannot
  // terminate the block it is embedded in.
  const localFxJson = jsonForScript(opts.localFx ?? {});

  return substituteTokens(template, {
    __DECK__: deckJson,
    __DECK_PROPS__: propsJson,
    __DECK_LOCAL_FX__: localFxJson,
    __FONT__: font,
    __RUNTIME__: runtime.replace(/<\/script/gi, "<\\/script"),
    __TITLE__: title.replace(/</g, "&lt;"),
  });
}
