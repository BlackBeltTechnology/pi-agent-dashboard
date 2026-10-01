/**
 * Authoring commands for local effects (design D1): `fx scaffold`, `fx hash`,
 * `fx promote`. Kept out of `cli.ts` because the stub source is a large
 * template that would fight the CLI's own template literals.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_KINDS, LOCAL_NAME_RE, sha256 } from "./local.js";
import { PERMISSIVE_LICENCES } from "./types.js";

export interface ScaffoldResult {
  ok: boolean;
  message: string;
  /** The override entry to paste, printed on success. */
  entry?: string;
}

const STUB_LINES = [
  "// __NAME__ — local deck3d effect for this deck. Licence: MIT.",
  "//",
  "// ctx = { THREE, palette, mode, quality, rng, slide: { id, title, kind } }",
  "// Determinism guardrail: Math.random() is the deck's seeded stream, and",
  "// window/document/fetch/setTimeout/Date/Promise are all undefined here.",
  "// No imports, no other exports.",
  "export default function (ctx, params) {",
  "  const { THREE, palette, quality, rng } = ctx;",
  "  const density = typeof params.density === 'number' ? params.density : 1;",
  "  const count = Math.max(8, Math.round((quality.particles / 30) * density));",
  "",
  "  const geo = new THREE.TetrahedronGeometry(0.4, 0);",
  "  const mat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.6, roughness: 0.4 });",
  "  const mesh = new THREE.InstancedMesh(geo, mat, count);",
  "  const m = new THREE.Matrix4();",
  "  const seeds = [];",
  "  for (let i = 0; i < count; i++) {",
  "    seeds.push({ x: (rng() - 0.5) * 24, y: (rng() - 0.5) * 12, z: (rng() - 0.5) * 10, ph: rng() * 6.283 });",
  "    m.makeTranslation(seeds[i].x, seeds[i].y, seeds[i].z);",
  "    mesh.setMatrixAt(i, m);",
  "  }",
  "  mesh.instanceMatrix.needsUpdate = true;",
  "",
  "  const group = new THREE.Group();",
  "  group.add(mesh);",
  "  group.userData.count = count;",
  "",
  "  return {",
  "    object: group,",
  "    tick: function (t) {",
  "      for (let i = 0; i < count; i++) {",
  "        const s = seeds[i];",
  "        m.makeTranslation(s.x, s.y + Math.sin(t * 0.6 + s.ph) * 0.8, s.z);",
  "        mesh.setMatrixAt(i, m);",
  "      }",
  "      mesh.instanceMatrix.needsUpdate = true;",
  "    },",
  "    dispose: function () {",
  "      geo.dispose();",
  "      mat.dispose();",
  "    },",
  "  };",
  "}",
];

function stubSource(name: string): string {
  return `${STUB_LINES.join("\n").replace("__NAME__", name)}\n`;
}

function stubCard(name: string, kind: string): string {
  return `${JSON.stringify(
    {
      id: name,
      kind,
      tags: { mood: ["custom"], content: [name], topic: [] },
      cost: 2,
      modes: "both",
      params: { density: { type: "number", default: 1, minimum: 0.2, maximum: 3 } },
      conflicts: [],
      source: "local",
      licence: "MIT",
    },
    null,
    2,
  )}\n`;
}

export function fxDir(deckDir: string): string {
  return join(deckDir, "fx");
}

/** `fx scaffold <name> [--kind k] [--for <slideId>]` — never overwrites. */
export function scaffoldLocalEffect(deckDir: string, name: string, kind: string, slideId?: string): ScaffoldResult {
  if (!LOCAL_NAME_RE.test(name)) {
    return { ok: false, message: `invalid local effect name '${name}' (must match ${LOCAL_NAME_RE.source})` };
  }
  if (!(LOCAL_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: `kind '${kind}' is not allowed for a local effect (one of ${LOCAL_KINDS.join(", ")})` };
  }
  const dir = fxDir(deckDir);
  const modulePath = join(dir, `${name}.js`);
  const cardPath = join(dir, `${name}.meta.json`);
  if (existsSync(modulePath) || existsSync(cardPath)) {
    return { ok: false, message: `fx/${name} already exists — edit it, or pick another name` };
  }

  mkdirSync(dir, { recursive: true });
  const src = stubSource(name);
  writeFileSync(modulePath, src);
  writeFileSync(cardPath, stubCard(name, kind));

  const ref = { id: `local:${name}`, sha256: sha256(src) };
  const where = slideId ? `overrides.slides["${slideId}"].effects` : "overrides.effects";
  return { ok: true, message: `wrote fx/${name}.js and fx/${name}.meta.json`, entry: `${where}: [${JSON.stringify(ref)}]` };
}

/** `fx hash <name>` — the current digest, to re-pin after an edit. */
export function hashLocalEffect(deckDir: string, name: string): ScaffoldResult {
  const modulePath = join(fxDir(deckDir), `${name}.js`);
  if (!existsSync(modulePath)) return { ok: false, message: `missing fx/${name}.js` };
  return { ok: true, message: sha256(readFileSync(modulePath)) };
}

export interface PromoteOptions {
  source?: string;
  licence?: string;
  /** Corpus directory to move into. Defaults to this package's `src/fx`. */
  corpusDir: string;
  /** Runs the corpus gate; a rejection rolls the move back. */
  verify: () => { ok: boolean; detail: string };
}

/**
 * `fx promote <name> --source <url> --licence <spdx>` — move a local pair into
 * the corpus. Both flags are required because a local card carries
 * `source: "local"`, which the corpus test rejects, and because scaffolds
 * routinely adapt three.js examples whose licence must be re-confirmed.
 */
export function promoteLocalEffect(deckDir: string, name: string, opts: PromoteOptions): ScaffoldResult {
  if (!opts.source) return { ok: false, message: "fx promote requires --source <url>" };
  if (!opts.licence) return { ok: false, message: "fx promote requires --licence <spdx>" };
  if (!(PERMISSIVE_LICENCES as readonly string[]).includes(opts.licence)) {
    return { ok: false, message: `licence '${opts.licence}' is not permissive (one of ${PERMISSIVE_LICENCES.join(", ")})` };
  }
  if (!/^https:\/\//.test(opts.source)) return { ok: false, message: `--source must be an https URL, got '${opts.source}'` };

  const fromModule = join(fxDir(deckDir), `${name}.js`);
  const fromCard = join(fxDir(deckDir), `${name}.meta.json`);
  if (!existsSync(fromModule) || !existsSync(fromCard)) return { ok: false, message: `missing fx/${name}.js or fx/${name}.meta.json` };

  const toModule = join(opts.corpusDir, `${name}.ts`);
  const toCard = join(opts.corpusDir, `${name}.meta.json`);
  if (existsSync(toModule) || existsSync(toCard)) return { ok: false, message: `corpus already has an effect named '${name}'` };

  const card = JSON.parse(readFileSync(fromCard, "utf8")) as Record<string, unknown>;
  card.source = opts.source;
  card.licence = opts.licence;

  // The module becomes a corpus TS module: same body, corpus export shape.
  const body = readFileSync(fromModule, "utf8").replace(/export\s+default\s+function/, "export const create = function");
  writeFileSync(toModule, body);
  writeFileSync(toCard, `${JSON.stringify(card, null, 2)}\n`);

  const verdict = opts.verify();
  if (!verdict.ok) {
    rmSync(toModule, { force: true });
    rmSync(toCard, { force: true });
    return { ok: false, message: `corpus gate rejected '${name}': ${verdict.detail}` };
  }

  rmSync(fromModule, { force: true });
  rmSync(fromCard, { force: true });
  return { ok: true, message: `promoted ${name} into the corpus (source ${opts.source}, licence ${opts.licence})` };
}
