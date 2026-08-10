/**
 * Discard-with-a-stated-handler wrapper around the plugin send primitive.
 *
 * A plugin message dispatched from an event handler or effect has no caller to
 * own its promise. Wrapping it here keeps the discard explicit and routes the
 * rejection to the package's logging path, so a dropped message is observable
 * instead of leaving the UI showing a change the server never applied.
 *
 * See change: cleanup-client-plugin-promises (design D1).
 */
export type PluginSend = (message: unknown) => void | Promise<void>;

export function makeSafeSend(send: PluginSend): (message: unknown) => void {
  return (message: unknown): void => {
    void Promise.resolve(send(message)).catch((err: unknown) => {
      console.error("[flows-plugin] plugin send failed:", err);
    });
  };
}
