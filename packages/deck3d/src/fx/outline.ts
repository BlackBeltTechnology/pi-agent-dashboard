import type { FxFactory, FxHandle } from "./types.js";

/** Post pass marker; the runtime post stack (`runtime/post.ts`) owns the actual pass. */
export const create: FxFactory = (): FxHandle => ({ pass: "outline", dispose: () => {} });
