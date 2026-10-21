/**
 * The provider stack `ChatView` requires (docs/embedding-chat-view.md). Mounted
 * ONLY standalone: an embedded host already provides the dashboard's own.
 * The registry + providers come from the `chat-embed` factory, so no client deep imports.
 * See change: add-team-plugin (D10/D16); decouple-plugins-from-core (D8).
 */
import {
  createHostPrimitiveRegistry,
  EmbedProviders,
  UiPrimitiveProvider,
} from "@blackbelt-technology/pi-dashboard-web/chat-embed";
import type { ReactNode } from "react";

let registry: ReturnType<typeof createHostPrimitiveRegistry> | undefined;
const hostRegistry = () => {
  registry ??= createHostPrimitiveRegistry();
  return registry;
};

export function ChatProviders({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  return (
    <UiPrimitiveProvider value={hostRegistry()}>
      <EmbedProviders apiBase={apiBase}>{children}</EmbedProviders>
    </UiPrimitiveProvider>
  );
}
