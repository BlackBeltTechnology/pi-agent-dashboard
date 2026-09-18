/**
 * chat-gateway — dashboard plugin client entry.
 *
 * Claims `settings-section` (see package.json). Reads/writes plugin config via
 * the runtime context; the token is writeOnly and never arrives here.
 *
 * See change: add-chat-gateway.
 */
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { ChatGatewayConfig } from "../shared/types.js";

export function ChatGatewaySettings(_props: SlotProps<"settings-section">) {
  const config = usePluginConfig<ChatGatewayConfig>();
  const send = usePluginSend();
  void usePluginSend;
  return (
    <div data-testid="chat-gateway-settings" style={{ padding: "8px" }}>
      <pre style={{ fontSize: "11px" }}>{JSON.stringify(config ?? {}, null, 2)}</pre>
      <button
        onClick={() =>
          send({ type: "plugin_config_write" as never, id: "chat-gateway", config: {} })
        }
      >
        Save
      </button>
    </div>
  );
}
