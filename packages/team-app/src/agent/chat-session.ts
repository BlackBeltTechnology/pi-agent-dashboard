/**
 * One conversation's live socket → `SessionState` (chat-embed's headless
 * reducer). Subscribes with `lastSeq: 0` on every (re)connect; the reducer's
 * reset-aware replay path de-duplicates the re-replay, so history is never
 * doubled. The host owns the ticketed URL (`host.api.wsUrl`).
 * See change: add-team-plugin (D10).
 */
import { type MinimalSocket, connectWithReconnect, type ReconnectHandle, type ReconnectStatus } from "@blackbelt-technology/pi-dashboard-app-kit";
import type { AppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useSessionState } from "@blackbelt-technology/pi-dashboard-web/chat-embed";
import { useCallback, useEffect, useRef, useState } from "react";

export interface TeamChat {
  state: ReturnType<typeof useSessionState>["state"];
  status: ReconnectStatus;
  sendPrompt(text: string): void;
  abort(): void;
}

export function useTeamChat(
  host: Pick<AppHost, "api">,
  sessionId: string | null,
  createSocket?: (url: string) => MinimalSocket,
): TeamChat {
  const { state, apply, reset } = useSessionState(sessionId ?? undefined);
  const [status, setStatus] = useState<ReconnectStatus>("connecting");
  const conn = useRef<ReconnectHandle | null>(null);
  // A caller-supplied factory (tests) must not re-run the connect effect on every render.
  const socketFactory = useRef(createSocket);
  socketFactory.current = createSocket;

  useEffect(() => {
    reset();
    if (!sessionId) {
      setStatus("disconnected");
      return;
    }
    const handle = connectWithReconnect({
      url: "/ws",
      resolveUrl: () => host.api.wsUrl("/ws"),
      onStatus: setStatus,
      onOpen: (send) => send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 })),
      onMessage: (raw) => {
        try {
          apply(JSON.parse(String(raw)));
        } catch {
          /* ignore non-JSON frames */
        }
      },
      createSocket: socketFactory.current,
    });
    conn.current = handle;
    return () => {
      handle.send(JSON.stringify({ type: "unsubscribe", sessionId }));
      handle.close();
      conn.current = null;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: apply/reset are stable per sessionId
  }, [sessionId, host]);

  const send = useCallback((payload: unknown) => conn.current?.send(JSON.stringify(payload)), []);
  const sendPrompt = useCallback(
    (text: string) => {
      if (!sessionId || !text.trim()) return;
      send({ type: "send_prompt", sessionId, text, delivery: "followUp" });
    },
    [sessionId, send],
  );
  const abort = useCallback(() => {
    if (sessionId) send({ type: "abort", sessionId });
  }, [sessionId, send]);

  return { state, status, sendPrompt, abort };
}
