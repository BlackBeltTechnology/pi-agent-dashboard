/**
 * Transparent effect geometry must sort ABOVE the floor veil.
 *
 * Effects that blend set `depthWrite: false` so overlapping pieces mix instead
 * of depth-fighting. Nothing then writes depth where they cover the distance,
 * so the veil — drawn later at `renderOrder 1`, opaque background colour past
 * its ramp — passed its own depth test against the FLOOR BEHIND them and
 * overpainted them, punching a band of pure background across the frame at the
 * horizon. Loud on slide 15 (`geo-fragments`, filled plates: rows read
 * `110 111 | 11 11 12 15 | 25 36 45`), quiet on slide 5 (`constellation`,
 * points + lines). Immune to `lift`, because the veil band is fixed in SCREEN
 * space while `lift` moves geometry in world space.
 *
 * Asserted as a render-order fact, not in pixels: a pixel probe on a sparse
 * fixture could not discriminate (steepest-drop ratio 0.31 buggy vs 0.41
 * fixed) and passed with the bug deliberately restored.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { resolvePalette } from "../../runtime/palette.js";
import { qualityProfile } from "../../runtime/quality.js";
import { makeRng } from "../../runtime/rng.js";
import { sortAboveVeil, VEIL_RENDER_ORDER } from "../../runtime/scene.js";
import { REGISTRY } from "../index.js";
import type { FxContext } from "../types.js";

function ctx(): FxContext {
  return {
    THREE,
    palette: resolvePalette({ palette: "blackbelt", mode: "dark" }),
    mode: "dark",
    quality: qualityProfile("high"),
    rng: makeRng(7),
    slide: { id: "s", title: "t", kind: "content" },
  } as unknown as FxContext;
}

/** Nodes whose material skips depth writes, with their draw order. */
function blendingNodes(root: THREE.Object3D): Array<{ label: string; order: number }> {
  const out: Array<{ label: string; order: number }> = [];
  root.traverse((n) => {
    const material = (n as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    const skips = Array.isArray(material) ? material.some((m) => m.depthWrite === false) : material.depthWrite === false;
    if (skips) out.push({ label: `${n.type}`, order: n.renderOrder });
  });
  return out;
}

describe("F42 transparent effect geometry sorts above the floor veil", () => {
  // The two the deck actually hit, plus the rest of the corpus that blends.
  for (const id of ["geo-fragments", "constellation", "billboards", "points-on-geometry", "shader-particles", "sprites"]) {
    it(`${id}: every blending node is drawn after the veil`, () => {
      const entry = REGISTRY[id];
      expect(entry, `${id} must exist in the corpus`).toBeDefined();
      const handle = entry.create(ctx(), {});
      const root = handle.object as THREE.Object3D | undefined;
      expect(root, `${id} must build an object`).toBeDefined();
      if (!root) return;

      const before = blendingNodes(root);
      expect(before.length, `${id} declares no depthWrite:false node — update this list`).toBeGreaterThan(0);

      // The runtime applies this to every effect it attaches (background,
      // rebuilt background, and `local:` modules).
      sortAboveVeil(root);

      const offenders = blendingNodes(root).filter((n) => n.order <= VEIL_RENDER_ORDER);
      expect(offenders, `must sort above the veil (renderOrder > ${VEIL_RENDER_ORDER})`).toEqual([]);
      handle.dispose?.();
    });
  }

  it("leaves opaque geometry alone", () => {
    const opaque = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const blending = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ depthWrite: false }));
    const root = new THREE.Group();
    root.add(opaque, blending);

    sortAboveVeil(root);

    expect(opaque.renderOrder, "opaque geometry keeps its own order").toBe(0);
    expect(blending.renderOrder).toBe(VEIL_RENDER_ORDER + 1);
  });

  it("does not demote an effect that already sorts higher", () => {
    const high = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ depthWrite: false }));
    high.renderOrder = 5;
    sortAboveVeil(high);
    expect(high.renderOrder).toBe(5);
  });
});
