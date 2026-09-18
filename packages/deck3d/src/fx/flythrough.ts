import type { FxFactory, FxHandle } from "./types.js";

/** Transition id; the runtime camera picks the matching interpolation. */
export const create: FxFactory = (): FxHandle => ({ pass: "transition:flythrough", dispose: () => {} });
