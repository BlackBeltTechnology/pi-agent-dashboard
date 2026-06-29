/**
 * StatusPill primitive — state-tinted pill (badge) with optional MDI icon.
 *
 * Registered as `ui:status-pill` in the primitive registry. Plugins emit
 * `{primitive: "ui:status-pill", props: {state, text, icon?}}`.
 *
 * Provides a consistent badge style so plugins migrating to intent
 * rendering get visual parity. See change:
 * adopt-server-driven-intent-rendering.
 */
import React, { useEffect, useState } from "react";
import Icon from "@mdi/react";
import type {
  UiStatusPillProps,
  UiStatusPillState,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";

const STATE_STYLE_DARK: Record<UiStatusPillState, { bg: string; fg: string }> = {
  running: { bg: "rgba(34, 197, 94, 0.15)", fg: "rgb(134, 239, 172)" },
  success: { bg: "rgba(34, 197, 94, 0.15)", fg: "rgb(134, 239, 172)" },
  info: { bg: "rgba(59, 130, 246, 0.15)", fg: "rgb(147, 197, 253)" },
  warn: { bg: "rgba(234, 179, 8, 0.15)", fg: "rgb(253, 224, 71)" },
  error: { bg: "rgba(239, 68, 68, 0.15)", fg: "rgb(252, 165, 165)" },
  muted: { bg: "rgba(107, 114, 128, 0.2)", fg: "rgb(209, 213, 219)" },
};

const STATE_STYLE_LIGHT: Record<UiStatusPillState, { bg: string; fg: string }> = {
  running: { bg: "rgba(34, 197, 94, 0.18)", fg: "rgb(21, 128, 61)" },
  success: { bg: "rgba(34, 197, 94, 0.18)", fg: "rgb(21, 128, 61)" },
  info: { bg: "rgba(59, 130, 246, 0.15)", fg: "rgb(29, 78, 216)" },
  warn: { bg: "rgba(234, 179, 8, 0.20)", fg: "rgb(161, 98, 7)" },
  error: { bg: "rgba(239, 68, 68, 0.15)", fg: "rgb(185, 28, 28)" },
  muted: { bg: "rgba(107, 114, 128, 0.20)", fg: "rgb(55, 65, 81)" },
};

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

export function StatusPill({ state, text, icon, tooltip }: UiStatusPillProps) {
  const light = useIsLightTheme();
  const palette = light ? STATE_STYLE_LIGHT[state] : STATE_STYLE_DARK[state];
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: palette.bg, color: palette.fg }}
      data-status-pill={state}
    >
      {icon ? <IconByKey iconKey={icon} /> : null}
      <span>{text}</span>
    </span>
  );
}

function IconByKey({ iconKey }: { iconKey: string }) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@mdi/js")
      .then((mdi) => {
        if (cancelled) return;
        const candidate = (mdi as Record<string, unknown>)[iconKey];
        setPath(typeof candidate === "string" ? candidate : null);
      })
      .catch(() => setPath(null));
    return () => {
      cancelled = true;
    };
  }, [iconKey]);
  if (!path) return null;
  return <Icon path={path} size={0.55} />;
}
