import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `bank`: dolly that rolls the camera into the move and back out (about 8 degrees).
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:bank", dispose: () => {} });
