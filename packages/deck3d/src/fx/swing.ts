import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `swing`: dolly with a sideways arc away from the mid-point between the slides.
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:swing", dispose: () => {} });
