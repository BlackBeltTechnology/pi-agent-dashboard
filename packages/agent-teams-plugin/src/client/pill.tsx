/**
 * Table-driven status pill without any string table: the caller passes the label,
 * the `status-map.ts` entry supplies glyph and pill state. `SettingsStatusPill
 * icon={null}` (the implementation behind `ui:status-pill`) because the table's
 * own glyph is the shape; `pulse` animates the glyph and stops under
 * `prefers-reduced-motion` (`motion-reduce`). Shared by the Team view and the tool
 * renderers so neither imports the other's string table.
 * See change: add-agent-teams-ui (design D12).
 */
import { SettingsStatusPill, type SettingsStatusTone } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { ReactElement } from "react";
import type { PillState, StatusEntry } from "./status-map.js";

const TONE: Record<PillState, SettingsStatusTone> = {
  running: "info",
  success: "success",
  error: "error",
  info: "info",
  warn: "warning",
  muted: "neutral",
};

export function PillView({ entry, label, status, testId, pulse }: { entry: StatusEntry; label: string; status: string; testId?: string; pulse?: boolean }): ReactElement {
  return (
    <SettingsStatusPill tone={TONE[entry.pill]} icon={null} status={status} testId={testId}>
      <span aria-hidden="true" className={pulse ? "animate-pulse motion-reduce:animate-none" : undefined}>
        {entry.glyph}
      </span>
      {label}
    </SettingsStatusPill>
  );
}
