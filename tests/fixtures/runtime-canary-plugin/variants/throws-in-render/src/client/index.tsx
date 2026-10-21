// Failure variant: the claim throws while rendering — the slot error boundary must contain it.
export function VariantPanel(): never {
  throw new Error("runtime-canary: render failure (expected)");
}
