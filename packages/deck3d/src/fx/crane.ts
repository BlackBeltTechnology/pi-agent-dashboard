import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `crane`: rises above the gap like a crane shot, then descends onto the slide.
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:crane", dispose: () => {} });
