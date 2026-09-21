import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Permissive port of a three.js example. */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const light = new ctx.THREE.PointLight(ctx.palette.accent, 1, 30);
  void params;
  return { object: light, dispose: () => light.dispose?.() };
};
