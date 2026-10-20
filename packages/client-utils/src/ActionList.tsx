/**
 * ActionList primitive — horizontal row of action buttons.
 *
 * Registered as `ui:action-list` in the primitive registry. Plugins emit
 * `{primitive: "ui:action-list", props: {actions: [...]}}` and each
 * connected client renders this component.
 *
 * See change: adopt-server-driven-intent-rendering.
 */

import { sendPluginAction } from "@blackbelt-technology/dashboard-plugin-runtime";
// Icon is an MDI key string, resolved lazily via useMdiIconByKey.
import type { UiActionListItem, UiActionListProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import Icon from "@mdi/react";
import { useContext } from "react";
import { ActionListMenuContext } from "./ActionListMenuContext.js";
import { useMdiIconByKey } from "./mdi-by-key.js";
import { toneAttr, toneIconClass, toneRowClass } from "./tone.js";

/**
 * Extended item shape: in addition to `onClick`, items may carry a
 * server-side action descriptor in `dataAction`. When the user clicks,
 * `dataAction` (if present) is dispatched via `sendPluginAction`.
 * Plugins emitting intents use `dataAction`; direct React callers can
 * still pass `onClick`.
 */
type ExtendedActionItem = UiActionListItem & {
  dataAction?: {
    pluginId: string;
    sessionId?: string | null;
    action: string;
    payload?: Record<string, unknown>;
  };
};

function runAction(a: ExtendedActionItem): void {
  if (a.dataAction) {
    sendPluginAction(a.dataAction.pluginId, a.dataAction.sessionId ?? null, a.dataAction.action, a.dataAction.payload);
  }
  if (a.onClick) a.onClick();
}

export function ActionList({ actions }: UiActionListProps) {
  const menu = useContext(ActionListMenuContext);
  if (!actions || actions.length === 0) return null;
  if (menu) {
    // Menu context: vertical menuitems. Disabled items stay focusable
    // (aria-disabled) and neither dispatch nor report activation.
    return (
      <div className="flex flex-col items-stretch">
        {(actions as ExtendedActionItem[]).map((a, i) => (
          <button
            key={i}
            type="button"
            role="menuitem"
            data-testid="action-list-item"
            aria-disabled={a.disabled ? "true" : undefined}
            data-action-tone={toneAttr(a.tone)}
            title={a.tooltip}
            onClick={() => {
              if (a.disabled) return;
              runAction(a);
              menu.onActivate?.();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] ${toneRowClass(a.tone, { disabled: !!a.disabled }) || "hover:bg-[var(--bg-tertiary)]"} aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors`}
          >
            {a.icon ? <IconByKey iconKey={a.icon} className={toneIconClass(a.tone, { disabled: !!a.disabled })} /> : null}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-row flex-wrap gap-1 items-center">
      {(actions as ExtendedActionItem[]).map((a, i) => {
        const handleClick = () => {
          if (a.disabled) return;
          runAction(a);
        };
        return (
          <button
            key={i}
            type="button"
            onClick={handleClick}
            disabled={a.disabled}
            data-action-tone={toneAttr(a.tone)}
            title={a.tooltip}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
          >
            {a.icon ? <IconByKey iconKey={a.icon} className={toneIconClass(a.tone, { disabled: !!a.disabled })} /> : null}
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Render an MDI icon by its export-name key. Renders nothing while the full
 * icon set loads and for unknown keys. See change:
 * harden-ios-safari-memory-and-ws-diagnostics.
 */
function IconByKey({ iconKey, className }: { iconKey: string; className?: string }) {
  const path = useMdiIconByKey(iconKey);
  if (!path) return null;
  return <Icon path={path} size={0.6} {...(className ? { className } : {})} />;
}
