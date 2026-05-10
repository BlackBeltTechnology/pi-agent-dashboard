/**
 * HonchoBadge — session-card-memory slot.
 * Returns null when extension uninstalled. Renders MDI brain + state as a pill.
 * Uses MDI icons for size consistency across OS/browsers (emoji renders inconsistently).
 * Task 7.1.
 */
import React, { useEffect, useState } from "react";
import Icon from "@mdi/react";
import { mdiBrain } from "@mdi/js";
import { useExtensionInstalled, useHonchoStatus } from "./hooks.js";

/** Tracks `<html data-theme>` reactively so badge palette flips with the dashboard theme. */
function useIsLightTheme(): boolean {
  const read = () =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";
  const [light, setLight] = useState(read);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => setLight(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

// Dark palette: 300-shade text on translucent tint. Works on near-black bg.
const STATE_STYLE_DARK: Record<string, { bg: string; fg: string }> = {
  connected:        { bg: "rgba(34, 197, 94, 0.15)",  fg: "rgb(134, 239, 172)" },
  running:          { bg: "rgba(34, 197, 94, 0.15)",  fg: "rgb(134, 239, 172)" },
  syncing:          { bg: "rgba(234, 179, 8, 0.15)",  fg: "rgb(253, 224, 71)" },
  starting:         { bg: "rgba(234, 179, 8, 0.15)",  fg: "rgb(253, 224, 71)" },
  configured:       { bg: "rgba(59, 130, 246, 0.15)", fg: "rgb(147, 197, 253)" },
  offline:          { bg: "rgba(239, 68, 68, 0.15)",  fg: "rgb(252, 165, 165)" },
  "docker-missing": { bg: "rgba(239, 68, 68, 0.15)",  fg: "rgb(252, 165, 165)" },
  "port-conflict":  { bg: "rgba(239, 68, 68, 0.15)",  fg: "rgb(252, 165, 165)" },
  stopped:          { bg: "rgba(107, 114, 128, 0.2)", fg: "rgb(209, 213, 219)" },
  uninstalled:      { bg: "rgba(107, 114, 128, 0.2)", fg: "rgb(209, 213, 219)" },
};

// Light palette: 700-shade text + slightly stronger tint for AA contrast on #f0f0f0.
const STATE_STYLE_LIGHT: Record<string, { bg: string; fg: string }> = {
  connected:        { bg: "rgba(34, 197, 94, 0.18)",  fg: "rgb(21, 128, 61)" },   // green-700
  running:          { bg: "rgba(34, 197, 94, 0.18)",  fg: "rgb(21, 128, 61)" },
  syncing:          { bg: "rgba(234, 179, 8, 0.20)",  fg: "rgb(161, 98, 7)" },    // yellow-700
  starting:         { bg: "rgba(234, 179, 8, 0.20)",  fg: "rgb(161, 98, 7)" },
  configured:       { bg: "rgba(59, 130, 246, 0.15)", fg: "rgb(29, 78, 216)" },   // blue-700
  offline:          { bg: "rgba(239, 68, 68, 0.15)",  fg: "rgb(185, 28, 28)" },   // red-700
  "docker-missing": { bg: "rgba(239, 68, 68, 0.15)",  fg: "rgb(185, 28, 28)" },
  "port-conflict":  { bg: "rgba(239, 68, 68, 0.15)",  fg: "rgb(185, 28, 28)" },
  stopped:          { bg: "rgba(107, 114, 128, 0.20)", fg: "rgb(55, 65, 81)" },   // gray-700
  uninstalled:      { bg: "rgba(107, 114, 128, 0.20)", fg: "rgb(55, 65, 81)" },
};

export function HonchoBadge() {
  const { installed, checking } = useExtensionInstalled();
  const { status } = useHonchoStatus();
  const light = useIsLightTheme();

  if (checking || !installed) return null;

  const palette = light ? STATE_STYLE_LIGHT : STATE_STYLE_DARK;
  const state = status?.state ?? "offline";
  const { bg, fg } = palette[state] ?? palette.stopped;

  return (
    <span
      data-testid="honcho-badge"
      title={`Honcho: ${state}`}
      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded font-mono text-[10px]"
      // verticalAlign: middle as inline style — Tailwind's `align-middle` class
      // isn't shipped (honcho-plugin source not in dashboard's Tailwind content
      // scan). Without this, the pill's baseline (driven by the SVG icon's
      // bottom edge) differs from sibling pills whose
      // baseline comes from text. Result: ~4px vertical offset between pills.
      style={{ background: bg, color: fg, verticalAlign: "middle" }}
    >
      {/* mdiBrain viewbox has more padding than other MDI icons; 0.6 ≈ 0.5 of siblings. */}
      <Icon path={mdiBrain} size={0.6} />
      <span>{state}</span>
    </span>
  );
}
