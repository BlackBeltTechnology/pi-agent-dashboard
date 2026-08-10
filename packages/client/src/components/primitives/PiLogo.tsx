import React from "react";
import { t } from "../../lib/i18n/i18n.js";

/**
 * Inline SVG of the pi-dashboard brand mark (bold geometric Π).
 * Uses `currentColor` so it inherits the CSS color of its parent — this
 * makes it automatically adapt to light/dark themes with a fully
 * transparent background (unlike the square PNG favicon).
 */
export function PiLogo({
  size = 24,
  className = "",
  title = t("common.piDashboard", undefined, "Pi Dashboard"),
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
      fill="currentColor"
    >
      {/* Top crossbar */}
      <rect x="3" y="5" width="18" height="3.2" rx="0.6" />
      {/* Left leg */}
      <rect x="5.5" y="8.2" width="3.4" height="11.3" rx="0.6" />
      {/* Right leg */}
      <rect x="15.1" y="8.2" width="3.4" height="11.3" rx="0.6" />
    </svg>
  );
}
