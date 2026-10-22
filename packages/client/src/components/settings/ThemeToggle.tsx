import { mdiMonitor, mdiWeatherNight, mdiWeatherSunny } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ThemePreference } from "../../hooks/useTheme.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useThemeContext } from "./ThemeProvider.js";

const options: Array<{ value: ThemePreference; icon: string; key: string; fallback: string }> = [
  { value: "light", icon: mdiWeatherSunny, key: "common.themeLight", fallback: "Light" },
  { value: "system", icon: mdiMonitor, key: "common.themeSystem", fallback: "System" },
  { value: "dark", icon: mdiWeatherNight, key: "common.themeDark", fallback: "Dark" },
];

/**
 * Segmented Light / System / Dark control (icon + visible label). Mounted only
 * inside the ThemePicker dropdown. See change: polish-sidebar-header-controls (D4).
 */
export function ThemeToggle() {
  const { preference, setPreference } = useThemeContext();

  return (
    <div
      className="grid grid-cols-3 gap-0.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-0.5"
      data-testid="theme-toggle"
    >
      {options.map((opt) => {
        const label = i18nT(opt.key, undefined, opt.fallback);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPreference(opt.value)}
            className="focus-ring inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded border border-transparent px-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--text-primary)] max-sm:min-h-11"
            title={label}
            aria-pressed={preference === opt.value}
            data-testid={`theme-${opt.value}`}
          >
            <Icon path={opt.icon} size={0.6} className="shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
