/**
 * Stylistic background corpus — three.js example ports (#E52–#E54, Section 18).
 *
 * Every card must be a pure function of (seed, t): same seed ⇒ same transforms;
 * scale with the quality tier; draw only palette colours; and stay OUT of topic
 * routing — they are explicit presets, not auto-picked worlds.
 */
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { runCli } from "../../__tests__/helpers/local-fx.js";
import { resolvePalette } from "../../runtime/palette.js";
import { qualityProfile } from "../../runtime/quality.js";
import { makeRng } from "../../runtime/rng.js";
import { backgroundForTopic } from "../defaults.js";
import { REGISTRY } from "../index.js";
import { FX_TOPICS, type FxParams } from "../types.js";

export const STYLISTIC = [
  "clipped-solids",
  "extruded-shapes",
  "scatter",
  "tessellate",
  "curve-flow",
  "sprites",
  "volume-cloud",
  "volume-perlin",
  "billboards",
  "points-on-geometry",
  "shader-particles",
  "dynamic-instances",
] as const;

const palette = resolvePalette({ palette: "blackbelt", mode: "dark" });
const PALETTE_HEX = new Set(Object.values(palette).map((c) => new THREE.Color(c as string).getHexString()));

function ctx(seed: number, tier: "low" | "high" = "high") {
  return { THREE, palette, mode: "dark" as const, quality: qualityProfile(tier), rng: makeRng(seed), slide: { id: "s", title: "t", kind: "content" } };
}

/**
 * Fingerprint of everything an effect seeds or animates: object matrices,
 * instance matrices, every geometry attribute (positions, per-vertex sizes,
 * instanced offsets…) and any data texture a material carries (the volume
 * raymarchers' randomness lives entirely in their 3D texture).
 */
function digest(root: THREE.Object3D): string {
  const parts: string[] = [];
  root.updateMatrixWorld(true);
  const slice = (a: ArrayLike<number>, n: number) => Array.from(a as number[]).slice(0, n).map((v) => Number(v).toFixed(4)).join(",");
  root.traverse((o) => {
    parts.push(o.matrixWorld.elements.map((v) => v.toFixed(4)).join(","));
    const im = (o as THREE.InstancedMesh).instanceMatrix;
    if (im) parts.push(slice(im.array, 64));
    const geo = (o as THREE.Mesh).geometry;
    if (geo) for (const [name, attr] of Object.entries(geo.attributes)) parts.push(`${name}:${slice((attr as THREE.BufferAttribute).array, 48)}`);
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      const uniforms = (m as THREE.ShaderMaterial).uniforms ?? {};
      for (const u of Object.values(uniforms)) {
        const data = (u as { value?: { image?: { data?: ArrayLike<number> } } }).value?.image?.data;
        // Mid-volume: the raymarchers fade their box edges to zero for every seed.
        if (data) parts.push(`tex:${slice(Array.prototype.slice.call(data, data.length >> 1), 96)}`);
      }
    }
  });
  return parts.join("|");
}

describe("E52 stylistic backgrounds are deterministic, scaled and palette-bound", () => {
  it.each(STYLISTIC)("%s is registered as a background with no topic tag", (id) => {
    const entry = REGISTRY[id];
    expect(entry, id).toBeDefined();
    expect(entry.card.kind).toBe("background");
    expect(entry.card.tags.topic ?? []).toEqual([]);
    expect(entry.card.source.startsWith("https://")).toBe(true);
  });

  it.each(STYLISTIC)("%s: same seed + same t ⇒ same transforms; different seed ⇒ different", (id) => {
    const make = (seed: number) => {
      const h = REGISTRY[id].create(ctx(seed), {});
      h.tick?.(1.3);
      const d = digest(h.object as THREE.Object3D);
      h.dispose();
      return d;
    };
    expect(make(7)).toBe(make(7));
    expect(make(7)).not.toBe(make(8));
  });

  it.each(STYLISTIC)("%s: low tier count ≤ half of high", (id) => {
    const at = (tier: "low" | "high") => {
      const h = REGISTRY[id].create(ctx(3, tier), {});
      const n = h.object?.userData.count as number;
      h.dispose();
      return n;
    };
    const lo = at("low");
    const hi = at("high");
    expect(hi, `${id} must expose userData.count`).toBeGreaterThan(0);
    expect(lo).toBeLessThanOrEqual(hi / 2);
  });

  it.each(STYLISTIC)("%s: every plain material colour comes from the palette", (id) => {
    const h = REGISTRY[id].create(ctx(1), {});
    const bad: string[] = [];
    (h.object as THREE.Object3D).traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        if ((m as THREE.ShaderMaterial).isShaderMaterial || m.colorWrite === false) continue;
        const c = (m as THREE.MeshStandardMaterial).color;
        if (c && !PALETTE_HEX.has(c.getHexString())) bad.push(`${o.name || o.type}:${c.getHexString()}`);
      }
    });
    h.dispose();
    expect(bad, id).toEqual([]);
  });
});

describe("E53 extruded-shapes accepts an SVG path string", () => {
  it("builds non-empty geometry from `svgPath` and from every built-in shape", () => {
    const tris = (params: FxParams): number => {
      const h = REGISTRY["extruded-shapes"].create(ctx(2), params);
      let n = 0;
      (h.object as THREE.Object3D).traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g) n += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
      });
      h.dispose();
      return n;
    };
    expect(tris({ svgPath: "M0 0 L10 0 L5 8 Z" })).toBeGreaterThan(0);
    for (const shape of ["star", "gear", "rose", "heart", "superformula", "arrow"]) expect(tris({ shape }), shape).toBeGreaterThan(0);
    // Garbage path data must not throw: fall back to a built-in.
    expect(tris({ svgPath: "not a path" })).toBeGreaterThan(0);
  });
});

describe("E54 stylistic backgrounds never enter topic routing", () => {
  it("backgroundForTopic returns none of them for any topic", () => {
    const set = new Set<string>(STYLISTIC);
    for (const topic of FX_TOPICS) expect(set.has(backgroundForTopic(topic) ?? ""), topic).toBe(false);
  });

  it("constellation exposes nodeShape point|sphere|cube and changes its geometry with it", () => {
    const card = REGISTRY.constellation.card;
    expect((card.params.nodeShape as { enum: string[] }).enum).toEqual(["point", "sphere", "cube"]);
    const kinds = (shape: string) => {
      const h = REGISTRY.constellation.create(ctx(4), { nodeShape: shape });
      const types = new Set<string>();
      // `InstancedMesh.type` is "Mesh"; the flag is the reliable discriminator.
      (h.object as THREE.Object3D).traverse((o) => types.add((o as THREE.InstancedMesh).isInstancedMesh ? "InstancedMesh" : o.type));
      h.dispose();
      return types;
    };
    expect(kinds("point").has("Points")).toBe(true);
    expect(kinds("sphere").has("InstancedMesh")).toBe(true);
    expect(kinds("cube").has("InstancedMesh")).toBe(true);
  });
});

const hasChromium = await chromiumAvailable();

describe.skipIf(!hasChromium)("E52 previews render something (chromium)", () => {
  it.each(STYLISTIC)("%s preview is non-empty", (id) => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e52-"));
    const out = join(dir, `${id}.png`);
    const r = runCli(["fx", "preview", id, "-o", out], dir);
    expect(r.status, r.stderr).toBe(0);
    // A blank frame is a few KB of flat PNG; anything drawn is far larger.
    expect(statSync(out).size).toBeGreaterThan(20_000);
  }, 60_000);
});
