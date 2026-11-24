/**
 * Tier-5 in-flight WebSocket registry (D8; change: serve-live-previews-on-capability-origin, test-plan #E78 #X20c).
 * An upgraded `/preview/<pid>/` socket is tracked under its pid; when the pid is dropped (holder revoked, target
 * removed, expired, previews disabled) every socket under it is closed with the drop, so a revoked preview
 * cannot keep talking to its dev server over an already-open HMR socket. In-flight HTTP responses (streams / SSE) are tracked
 * the same way, so no forwarded stream outlives its pid (test-plan #P11).
 */
/** Anything the drop can destroy: an upgraded socket, or an in-flight HTTP response (`ServerResponse.destroy()` drops its connection). */
interface PreviewClosable {
  destroy(): unknown;
  once(event: "close", listener: () => void): unknown;
}

export interface PreviewWsRegistry {
  /** Track an upgraded socket (or an in-flight HTTP response, P11) under `pid`; it untracks itself on `close`. */
  track(pid: string, socket: PreviewClosable): void;
  /** Destroy every tracked socket of `pid` (no-op for an unknown pid). Returns how many were closed. */
  closePid(pid: string): number;
}

export function createPreviewWsRegistry(): PreviewWsRegistry {
  const byPid = new Map<string, Set<PreviewClosable>>();
  return {
    track(pid, socket) {
      let set = byPid.get(pid);
      if (!set) byPid.set(pid, (set = new Set()));
      const mine = set;
      mine.add(socket);
      socket.once("close", () => {
        mine.delete(socket);
        if (mine.size === 0 && byPid.get(pid) === mine) byPid.delete(pid);
      });
    },
    closePid(pid) {
      const set = byPid.get(pid);
      if (!set) return 0;
      byPid.delete(pid);
      const n = set.size;
      for (const s of [...set]) s.destroy();
      return n;
    },
  };
}
