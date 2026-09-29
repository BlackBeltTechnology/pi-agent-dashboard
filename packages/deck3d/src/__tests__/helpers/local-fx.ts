/**
 * Test helper: build a deck directory carrying local effects in `fx/`.
 *
 * Every local-effect suite needs the same four steps (markdown → parse →
 * write modules → pin their hashes into `overrides`), so they live here rather
 * than in each spec.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

export function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A minimal valid local module: one cube, a tick and a dispose. */
export function stubModule(body?: string): string {
  return [
    "export default function (ctx, params) {",
    "  const { THREE, palette } = ctx;",
    "  const geo = new THREE.BoxGeometry(1, 1, 1);",
    "  const mat = new THREE.MeshBasicMaterial({ color: palette.accent });",
    "  const mesh = new THREE.Mesh(geo, mat);",
    "  const group = new THREE.Group();",
    "  group.add(mesh);",
    body ?? "",
    "  return { object: group, tick: function (t) { group.rotation.y = t; }, dispose: function () { geo.dispose(); mat.dispose(); } };",
    "}",
    "",
  ].join("\n");
}

export function stubCard(id: string, over: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      id,
      kind: "background",
      tags: { mood: ["custom"], content: [id] },
      cost: 2,
      modes: "both",
      params: { density: { type: "number", default: 1, minimum: 0, maximum: 1 } },
      conflicts: [],
      source: "local",
      licence: "MIT",
      ...over,
    },
    null,
    2,
  )}\n`;
}

export interface LocalFxSpec {
  name: string;
  src?: string;
  card?: Record<string, unknown>;
  /** Written into `overrides` instead of the real digest (hash-mismatch cases). */
  sha256?: string;
  /** Omit the `.meta.json` file entirely. */
  noCard?: boolean;
  /** Omit the `.js` file entirely. */
  noModule?: boolean;
}

export interface DeckSpec {
  /** Markdown body; defaults to one slide `# Geo`. */
  markdown?: string;
  /** Slide id the effects attach to; defaults to `geo`. */
  slide?: string;
  effects: LocalFxSpec[];
  /** Extra corpus effect ids composed before the local ones. */
  corpus?: string[];
  /** Merged into `overrides.deck`. */
  deck?: Record<string, unknown>;
}

export interface DeckDir {
  dir: string;
  deckPath: string;
  /** Digest actually on disk, per effect name. */
  digests: Record<string, string>;
}

/** Create a temp deck dir with `fx/` modules and their `overrides` entries. */
export function makeLocalDeck(spec: DeckSpec, prefix = "deck3d-localfx-"): DeckDir {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const slide = spec.slide ?? "geo";
  writeFileSync(join(dir, "deck.md"), spec.markdown ?? "# Geo\n\n- one\n- two\n");
  const parsed = runCli(["parse", "deck.md", "-o", "deck.json"], dir);
  if (parsed.status !== 0) throw new Error(`parse failed: ${parsed.stderr}`);

  mkdirSync(join(dir, "fx"), { recursive: true });
  const digests: Record<string, string> = {};
  const refs: Array<Record<string, unknown>> = (spec.corpus ?? []).map((id) => ({ id }));

  for (const fx of spec.effects) {
    const src = fx.src ?? stubModule();
    if (!fx.noModule) writeFileSync(join(dir, "fx", `${fx.name}.js`), src);
    if (!fx.noCard) writeFileSync(join(dir, "fx", `${fx.name}.meta.json`), stubCard(fx.name, fx.card ?? {}));
    digests[fx.name] = sha256(src);
    refs.push({ id: `local:${fx.name}`, sha256: fx.sha256 ?? digests[fx.name] });
  }

  const deckPath = join(dir, "deck.json");
  const deck = JSON.parse(readFileSync(deckPath, "utf8")) as Record<string, unknown>;
  const overrides = deck.overrides as Record<string, unknown>;
  overrides.slides = { [slide]: { effects: refs } };
  if (spec.deck) overrides.deck = spec.deck;
  writeFileSync(deckPath, `${JSON.stringify(deck, null, 2)}\n`);

  return { dir, deckPath, digests };
}
