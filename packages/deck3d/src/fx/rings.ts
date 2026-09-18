import { BACKGROUNDS } from "../runtime/backgrounds.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Ported from the strategy lab. */
export const create: FxFactory = (ctx: FxContext, _params: FxParams): FxHandle => {
  const animator = BACKGROUNDS["rings"](ctx.palette, ctx.quality);
  return { object: animator.g, tick: animator.tick, dispose: () => {} };
};
