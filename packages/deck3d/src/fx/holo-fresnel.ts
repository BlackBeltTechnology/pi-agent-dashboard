import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Permissive port of a three.js example. */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const mat = new ctx.THREE.MeshStandardMaterial({ color: ctx.palette.accent, metalness: 0.8, roughness: 0.3 });
  void params;
  return { material: mat, dispose: () => mat.dispose() };
};
