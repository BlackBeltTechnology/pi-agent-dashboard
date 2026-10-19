/**
 * GoalPluginSettings — settings-section slot (general tab).
 *
 * Minimal status panel: states that the loop, judge model, and turn budget
 * are owned by the required `@ricoyudog/pi-goal-hermes` pi extension, and
 * that the chip + controls activate when that extension is installed.
 *
 * See change: add-goal-continuation-plugin.
 */
import { SettingsStatusPill, ToggleField, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useState } from "react";
import { getAutoRespawnDefault, setAutoRespawnDefault } from "./goal-settings.js";

/** Settings body. The switch is an immediate per-browser preference (localStorage), not a host Save-bar source (design D4 exception). */
export function GoalPluginSettings(): React.ReactElement {
  const t = useT();
  const [autoRespawn, setAutoRespawn] = useState<boolean>(() => getAutoRespawnDefault());
  const code = "font-mono text-[12px] text-[var(--text-primary)]";
  return (
    <div className="space-y-3 text-xs text-[var(--text-secondary)]">
      <p>
        {t("settingsIntro1", undefined, "The autonomous goal loop, judge model, and turn budget are owned by the")}{" "}
        <code className={code}>@ricoyudog/pi-goal-hermes</code>{" "}
        {t("settingsIntro2", undefined, "pi extension. This plugin surfaces its status as a session-card chip.")}
      </p>
      <p>
        {t("settingsInstall", undefined, "Install the extension into pi to activate. Set or control a goal from a session using")}{" "}
        <code className={code}>/goal &lt;objective&gt;</code>.
      </p>
      <div className="space-y-1">
        <SettingsStatusPill tone="neutral" icon={null} testId="goal-settings-browser-pill">
          {t("thisBrowser", undefined, "This browser")}
        </SettingsStatusPill>
        <ToggleField
          label={t("autoRespawnDefaultLabel", undefined, "Auto-restart new goals by default")}
          hint={`${t(
            "autoRespawnHelp",
            undefined,
            "When a goal's session dies, start a new one to keep going — limited by the turn budget and a crash-loop breaker. Each goal can override this.",
          )} ${t("autoRespawnBrowserNote", undefined, "Saved in this browser only.")}`}
          value={autoRespawn}
          onChange={(v) => {
            setAutoRespawn(v);
            setAutoRespawnDefault(v);
          }}
          testIds={{ control: "goal-settings-auto-respawn-default" }}
        />
      </div>
    </div>
  );
}
