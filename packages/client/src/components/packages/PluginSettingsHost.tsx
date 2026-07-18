/**
 * Renders every `settings-section` claim that belongs to a given plugin id,
 * for use inline beneath the plugin's activation row in PluginsSection.
 *
 * The slot-registry enable filter ensures disabled plugins emit zero claims,
 * so we don't need to gate on `enabled` here.
 *
 * See change: add-plugin-activation-ui.
 */
import { SettingsSectionByPluginSlot } from "@blackbelt-technology/dashboard-plugin-runtime";

export function PluginSettingsHost({ pluginId }: { pluginId: string }) {
  return <SettingsSectionByPluginSlot pluginId={pluginId} />;
}
