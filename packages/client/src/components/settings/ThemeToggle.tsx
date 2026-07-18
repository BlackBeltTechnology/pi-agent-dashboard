import React from "react";
import { Icon } from "@mdi/react";
import { mdiWeatherSunny, mdiMonitor, mdiWeatherNight } from "@mdi/js";
import { useThemeContext } from "./ThemeProvider.js";
import type { ThemePreference } from "../../hooks/useTheme.js";

const options: Array<{ value: ThemePreference; icon: string; label: string }> = [
  { value: "light", icon: mdiWeatherSunny, label: "Light" },
  { value: "system", icon: mdiMonitor, label: "System" },
  { value: "dark", icon: mdiWeatherNight, label: "Dark" },
];

export function ThemeToggle() {
  const { preference, setPreference } = useThemeContext();

  return (
    <div className="flex rounded border border-[var(--border-primary)]" data-testid="theme-toggle">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPreference(opt.value)}
          className={`p-0.5 ${
            preference === opt.value
              ? "text-[var(--accent-blue)] bg-[var(--bg-tertiary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          title={opt.label}
          data-testid={`theme-${opt.value}`}
        >
          <Icon path={opt.icon} size={0.5} />
        </button>
      ))}
    </div>
  );
}
