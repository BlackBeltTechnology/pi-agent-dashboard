import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `flythrough`: low pass through the gap between the slides with a gentle bank and a wider lens.
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:flythrough", dispose: () => {} });
