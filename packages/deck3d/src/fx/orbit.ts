import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Motion preset applied to a slide's diagram group. */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const group = new ctx.THREE.Group();
  const amplitude = typeof params.amplitude === "number" ? params.amplitude : 0.2;
  return { object: group, tick: (t) => { group.rotation.y = Math.sin(t * 0.3) * amplitude; }, dispose: () => {} };
};
