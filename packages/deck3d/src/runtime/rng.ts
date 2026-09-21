/** Deterministic LCG (ported from the lab) so scene layout never uses Math.random. */
export function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
