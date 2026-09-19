/** Quality tiers (design D6): bloom / mirror / shadow map / particle count. */
import type { Quality } from "../ir/types.js";

export interface QualityProfile {
  bloom: boolean;
  mirror: boolean;
  shadowMapSize: number;
  particles: number;
}

export function qualityProfile(q: Quality | undefined): QualityProfile {
  switch (q) {
    case "low":
      return { bloom: false, mirror: false, shadowMapSize: 1024, particles: 400 };
    case "medium":
      return { bloom: true, mirror: true, shadowMapSize: 2048, particles: 900 };
    default:
      return { bloom: true, mirror: true, shadowMapSize: 4096, particles: 1500 };
  }
}
