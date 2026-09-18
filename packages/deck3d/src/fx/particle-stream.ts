import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Edge style decorator; the flowchart builder applies it to edge tubes. */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const group = new ctx.THREE.Group();
  void params;
  return { object: group, tick: () => {}, dispose: () => {} };
};
