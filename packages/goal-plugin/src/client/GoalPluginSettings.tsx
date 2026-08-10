/**
 * GoalPluginSettings — settings-section slot (general tab).
 *
 * Minimal status panel: states that the loop, judge model, and turn budget
 * are owned by the required `@ricoyudog/pi-goal-hermes` pi extension, and
 * that the chip + controls activate when that extension is installed.
 *
 * See change: add-goal-continuation-plugin.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useState } from "react";
import { getAutoRespawnDefault, setAutoRespawnDefault } from "./goal-settings.js";

export function GoalPluginSettings(): React.ReactElement {
  const t = useT();
  const [autoRespawn, setAutoRespawn] = useState<boolean>(() => getAutoRespawnDefault());
  return (
    <div className="text-[13px] text-[var(--text-secondary)] space-y-2">
      <p>
        {t("settingsIntro1", undefined, "The autonomous goal loop, judge model, and turn budget are owned by the")}{" "}
        <code className="font-mono text-[12px]">@ricoyudog/pi-goal-hermes</code>{" "}
        {t("settingsIntro2", undefined, "pi extension. This plugin surfaces its status as a session-card chip.")}
      </p>
      <p className="text-[var(--text-muted)]">
        {t("settingsInstall", undefined, "Install the extension into pi to activate. Set or control a goal from a session using")}{" "}
        <code className="font-mono text-[12px]">/goal &lt;objective&gt;</code>.
      </p>
      <label className="flex items-center gap-2 pt-1" data-testid="goal-settings-auto-respawn-default">
        <input
          type="checkbox"
          checked={autoRespawn}
          onChange={(e) => {
            setAutoRespawn(e.target.checked);
            setAutoRespawnDefault(e.target.checked);
          }}
        />
        <span>
          {t("autoRespawnDefaultLabel", undefined, "Auto-respawn new goals by default")}
          <span className="block text-[11px] text-[var(--text-muted)]">
            {t("autoRespawnHelp", undefined, "When a goal's driver session dies, the dashboard respawns it to keep pursuing — bounded by the turn budget and a crash-loop breaker. Off by default; each goal can override.")}
          </span>
        </span>
      </label>
    </div>
  );
}
