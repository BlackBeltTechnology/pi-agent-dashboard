/**
 * GoalPluginSettings — settings-section slot (general tab).
 *
 * Minimal status panel: states that the loop, judge model, and turn budget
 * are owned by the required `@ricoyudog/pi-goal-hermes` pi extension, and
 * that the chip + controls activate when that extension is installed.
 *
 * See change: add-goal-continuation-plugin.
 */
import React from "react";

export function GoalPluginSettings(): React.ReactElement {
  return (
    <div className="text-[13px] text-[var(--text-secondary)] space-y-2">
      <p>
        The autonomous goal loop, judge model, and turn budget are owned by the{" "}
        <code className="font-mono text-[12px]">@ricoyudog/pi-goal-hermes</code> pi
        extension. This plugin surfaces its status as a session-card chip.
      </p>
      <p className="text-[var(--text-muted)]">
        Install the extension into pi to activate. Set or control a goal from a
        session using <code className="font-mono text-[12px]">/goal &lt;objective&gt;</code>.
      </p>
    </div>
  );
}
