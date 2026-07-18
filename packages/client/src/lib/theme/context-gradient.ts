/**
 * Interpolates a color from green → yellow → red based on percentage (0–100).
 * Uses HSL interpolation:
 *   0%  → hsl(142, 71%, 45%)  green
 *  50%  → hsl(48, 96%, 53%)   yellow
 * 100%  → hsl(0, 84%, 60%)    red
 */
export function contextGradientColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));

  let h: number, s: number, l: number;

  if (p <= 50) {
    // green → yellow
    const t = p / 50;
    h = 142 + (48 - 142) * t;   // 142 → 48
    s = 71 + (96 - 71) * t;     // 71 → 96
    l = 45 + (53 - 45) * t;     // 45 → 53
  } else {
    // yellow → red
    const t = (p - 50) / 50;
    h = 48 + (0 - 48) * t;      // 48 → 0
    s = 96 + (84 - 96) * t;     // 96 → 84
    l = 53 + (60 - 53) * t;     // 53 → 60
  }

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}
