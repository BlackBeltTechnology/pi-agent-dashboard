import { useCallback, useEffect, useState } from "react";
import { listServers, removeServer, type KeyringEntry } from "../lib/keyring.js";
import { connectServer, type ConnectLog } from "../lib/connect.js";

export function KeyringView({ refreshKey }: { refreshKey?: number }) {
  const [servers, setServers] = useState<KeyringEntry[]>([]);
  const [logs, setLogs] = useState<Record<string, ConnectLog>>({});
  const [connecting, setConnecting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setServers(await listServers());
  }, []);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  const connect = useCallback(async (entry: KeyringEntry) => {
    setConnecting(entry.id);
    const log = await connectServer(entry);
    setLogs((prev) => ({ ...prev, [entry.id]: log }));
    setConnecting(null);
  }, []);

  const remove = useCallback(async (id: string) => {
    await removeServer(id);
    await reload();
  }, [reload]);

  if (servers.length === 0) {
    return <p className="text-sm text-neutral-500">No paired servers yet. Pair one to get started.</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-3">
      <h2 className="text-lg font-semibold">Paired servers</h2>
      {servers.map((s) => {
        const log = logs[s.id];
        return (
          <div key={s.id} className="rounded border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-100">{s.label}</p>
                <p className="truncate font-mono text-xs text-neutral-500">{s.pinnedFingerprint}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => connect(s)}
                  disabled={connecting === s.id}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  {connecting === s.id ? "Connecting…" : "Connect"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="rounded bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300"
                >
                  Remove
                </button>
              </div>
            </div>
            {log && (
              <div
                className={`mt-2 rounded p-2 text-xs ${
                  log.identityMismatch
                    ? "border border-red-800 bg-red-950/40 text-red-300"
                    : log.ok
                      ? "border border-green-800 bg-green-950/40 text-green-300"
                      : "border border-neutral-800 bg-neutral-950 text-neutral-400"
                }`}
              >
                {log.identityMismatch && (
                  <p className="font-semibold">⚠ Identity mismatch — refused: {log.identityMismatch}</p>
                )}
                <ul className="font-mono">
                  {log.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
