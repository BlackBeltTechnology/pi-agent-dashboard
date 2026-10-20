/**
 * `ui:chat-view` — the host chat of one session as a self-providing primitive.
 *
 * A plugin renders `useUiPrimitive(UI_PRIMITIVE_KEYS.chatView)` with a
 * `sessionId` and gets the live transcript (+ composer unless `readOnly`).
 * The session's `SessionState` is derived from the shell's per-session event
 * stream (`useSessionEvents`), so the plugin needs no client source import.
 *
 * Providers: mounts `SessionAssetsProvider` (resolves `pi-asset:` refs for THIS
 * session). It mounts NO `UiPrimitiveProvider` — primitives used inside the chat
 * resolve from the enclosing app registry. Theme, router, mobile, api base and
 * display prefs come from the app (or `EmbedProviders`).
 *
 * See change: decouple-plugins-from-core (D8).
 */
import {
  usePluginSend,
  useSessionEvents,
  useSessionState,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { UiChatViewProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useMemo, useRef } from "react";
import { ChatView } from "../../components/chat/ChatView.js";
import { CommandInput } from "../../components/chat/CommandInput.js";
import { makeToolContext } from "../../components/tool-renderers/make-tool-context.js";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";
import { SessionAssetsProvider } from "../session/SessionAssetsContext.js";

interface FoldCache {
  sessionId: string;
  events: readonly DashboardEvent[];
  state: SessionState;
}

/**
 * Fold the session event stream into `SessionState`. Incremental: an append-only
 * growth of the same stream folds only the new tail; anything else (a clear on
 * `session_state_reset`, a different session) refolds from scratch.
 */
export function useFoldedSessionState(sessionId: string, events: readonly DashboardEvent[]): SessionState {
  const cache = useRef<FoldCache | null>(null);
  return useMemo(() => {
    const prev = cache.current;
    const appendOnly =
      prev !== null &&
      prev.sessionId === sessionId &&
      events.length >= prev.events.length &&
      prev.events.every((e, i) => events[i] === e);
    let state = appendOnly ? prev.state : createInitialState();
    for (let i = appendOnly ? prev.events.length : 0; i < events.length; i++) state = reduceEvent(state, events[i]);
    cache.current = { sessionId, events, state };
    return state;
  }, [sessionId, events]);
}

/** Registered under `UI_PRIMITIVE_KEYS.chatView` (`lib/plugins/host-primitives.tsx`). */
export const ChatViewPrimitive: React.FC<UiChatViewProps> = ({ sessionId, readOnly = false, compact = false }) => {
  const events = useSessionEvents(sessionId);
  const session = useSessionState(sessionId);
  const send = usePluginSend();
  const state = useFoldedSessionState(sessionId, events);
  const toolContext = useMemo(() => makeToolContext({ sessionId, session: state }), [sessionId, state]);
  const status = session?.status === "ended" ? "ended" : state.status === "streaming" ? "streaming" : "idle";
  return (
    <SessionAssetsProvider assets={session?.assets}>
      <div className="flex flex-col flex-1 min-h-0 h-full" data-testid="ui-chat-view" data-compact={compact || undefined}>
        <div className="flex flex-col flex-1 min-h-0">
          <ChatView sessionId={sessionId} state={state} toolContext={toolContext} />
        </div>
        {readOnly ? null : (
          <CommandInput
            commands={[]}
            sessionId={sessionId}
            sessionStatus={status}
            disabled={status === "ended"}
            onSend={(text, images, delivery) => {
              void send({ type: "send_prompt", sessionId, text, images, delivery });
            }}
          />
        )}
      </div>
    </SessionAssetsProvider>
  );
};
