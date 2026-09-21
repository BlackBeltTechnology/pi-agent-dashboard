import type { FxFactory, FxHandle } from "./types.js";

/** Post pass marker; the runtime composer owns the actual pass stack. */
export const create: FxFactory = (): FxHandle => ({ pass: "n8ao", dispose: () => {} });
