import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `dolly`: straight eased move to the arriving slide's anchor.
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:dolly", dispose: () => {} });
