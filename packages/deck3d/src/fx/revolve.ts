import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `revolve`: swings wide to the travel-right side and arcs in around the arriving slide.
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:revolve", dispose: () => {} });
