import type { FxFactory, FxHandle } from "./types.js";

/**
 * Camera transition `path`: author keyframed move from the slide's `cameraPath` (travel-frame offsets, look, roll, fov).
 * Motion lives in `runtime/transition.ts` (`makeMotion`); this card only
 * registers the id. Scale with the IR knob `transitionAmount`.
 */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:path", dispose: () => {} });
