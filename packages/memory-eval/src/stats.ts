/** Wilson interval and the exact two-sided McNemar test (design M6). */

/** Wilson score interval (z = 1.96 ⇒ 95%). Returns fractions; [0, 0] when n = 0. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, (centre - half) / denom), hi: Math.min(1, (centre + half) / denom) };
}

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** Exact two-sided McNemar p-value from the discordant counts (wins, losses). */
export function mcnemarExact(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const m = Math.min(wins, losses);
  let cdf = 0;
  for (let i = 0; i <= m; i++) cdf += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * cdf);
}

export const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
