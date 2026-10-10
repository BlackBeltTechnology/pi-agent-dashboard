import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `fade`: covers the screen with the palette background, switches the camera while covered, uncovers.
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:fade", dispose: () => {} });
