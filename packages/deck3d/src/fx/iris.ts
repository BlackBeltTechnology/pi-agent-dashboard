import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `iris`: closes a circular mask to the centre, switches the camera, reopens.
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:iris", dispose: () => {} });
