/**
 * chat-gateway — dashboard plugin client entry (settings-section, task 10.1).
 *
 * Edits the gateway config through the canonical partial-write lane
 * (`plugin_config_write` → `POST /api/config/plugins/chat-gateway`), which
 * shallow-merges: the TOKEN is writeOnly and omitted from the read-back, so a
 * blank token field keeps the stored secret rather than erasing it.
 *
 * The bindings table is read-only and fetched from the plugin's own
 * `/api/chat-gateway/bindings` route (registered only when configured).
 *
 * See change: add-chat-gateway.
 */

import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { Binding, ChatGatewayConfig } from "../shared/types.js";

interface BindingsResponse {
  bindings: Binding[];
  status: { running: boolean; boundChannels: number; pendingSpawns: number };
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatFixedMap(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** `channelKey=cwd` per line; the first `=` splits (cwd paths may contain none). */
function parseFixedMap(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const cwd = trimmed.slice(eq + 1).trim();
    if (key.length > 0 && cwd.length > 0) out[key] = cwd;
  }
  return out;
}

export function ChatGatewaySettings(_props: SlotProps<"settings-section">): React.ReactElement {
  const config = usePluginConfig<ChatGatewayConfig>();
  const send = usePluginSend();

  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [token, setToken] = useState("");
  const [allowedRoots, setAllowedRoots] = useState("");
  const [defaultCwd, setDefaultCwd] = useState("");
  const [fixedMap, setFixedMap] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [admins, setAdmins] = useState("");
  const [groupChannels, setGroupChannels] = useState("");
  const [steerPrefix, setSteerPrefix] = useState(config?.steerPrefix ?? "!");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [bindings, setBindings] = useState<BindingsResponse | null>(null);

  // Once the user edits, stop mirroring late-hydrating config so their typing
  // is never clobbered; a successful save clears dirty and re-mirrors.
  const dirty = useRef(false);

  const saved = {
    enabled: config?.enabled ?? true,
    allowedRoots: (config?.allowedRoots ?? []).join("\n"),
    defaultCwd: config?.defaultCwd ?? "",
    fixedMap: formatFixedMap(config?.fixedMap ?? {}),
    allowlist: (config?.allowlist ?? []).join(", "),
    admins: (config?.admins ?? []).join(", "),
    groupChannels: (config?.groupChannels ?? []).join(", "),
    steerPrefix: config?.steerPrefix ?? "!",
  };

  const savedKey = JSON.stringify(saved);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mirror on the serialized snapshot only.
  useEffect(() => {
    if (dirty.current) return;
    setEnabled(saved.enabled);
    setAllowedRoots(saved.allowedRoots);
    setDefaultCwd(saved.defaultCwd);
    setFixedMap(saved.fixedMap);
    setAllowlist(saved.allowlist);
    setAdmins(saved.admins);
    setGroupChannels(saved.groupChannels);
    setSteerPrefix(saved.steerPrefix);
  }, [savedKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/chat-gateway/bindings");
        if (!res.ok) return;
        const body = (await res.json()) as BindingsResponse;
        if (!cancelled) setBindings(body);
      } catch {
        /* unavailable until configured — leave the table hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notice]);

  function markDirty<T>(setter: (v: T) => void) {
    return (value: T) => {
      dirty.current = true;
      setter(value);
      setNotice(null);
    };
  }

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const partial: Record<string, unknown> = {
        enabled,
        allowedRoots: parseLines(allowedRoots),
        defaultCwd,
        fixedMap: parseFixedMap(fixedMap),
        allowlist: parseList(allowlist),
        admins: parseList(admins),
        groupChannels: parseList(groupChannels),
        steerPrefix,
      };
      // A blank token means "keep the stored secret" — never send it, so a
      // save cannot erase the token by omission-through-the-form.
      if (token.trim().length > 0) partial.token = token.trim();
      await send({ type: "plugin_config_write", id: "chat-gateway", config: partial });
      setToken("");
      dirty.current = false;
      setNotice({ kind: "ok", text: "Saved." });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-xs";
  const label = "block text-[11px] text-[var(--text-secondary)] mb-0.5";

  return (
    <div className="space-y-3" data-testid="chat-gateway-settings">
      <p className="text-xs text-[var(--text-secondary)]">
        Drive dashboard pi sessions from Discord. Inert until a bot token is set; every
        spawned cwd must be inside <code>allowedRoots</code>.
      </p>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          data-testid="chat-gateway-enabled"
          checked={enabled}
          onChange={(e) => markDirty(setEnabled)(e.target.checked)}
        />
        Enabled
      </label>

      <div>
        <span className={label}>Discord bot token</span>
        <input
          type="password"
          autoComplete="off"
          data-testid="chat-gateway-token"
          value={token}
          placeholder="Leave blank to keep the current token"
          onChange={(e) => markDirty(setToken)(e.target.value)}
          className={field}
        />
      </div>

      <div>
        <span className={label}>allowedRoots (one path per line — mandatory)</span>
        <textarea
          data-testid="chat-gateway-allowed-roots"
          value={allowedRoots}
          rows={3}
          onChange={(e) => markDirty(setAllowedRoots)(e.target.value)}
          className={field}
        />
      </div>

      <div>
        <span className={label}>Default cwd (still gated by allowedRoots)</span>
        <input
          data-testid="chat-gateway-default-cwd"
          value={defaultCwd}
          onChange={(e) => markDirty(setDefaultCwd)(e.target.value)}
          className={field}
        />
      </div>

      <div>
        <span className={label}>Fixed map — one <code>channelKey=cwd</code> per line</span>
        <textarea
          data-testid="chat-gateway-fixed-map"
          value={fixedMap}
          rows={3}
          placeholder="discord:123456789:-=/repos/proj"
          onChange={(e) => markDirty(setFixedMap)(e.target.value)}
          className={field}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <span className={label}>Allowlist (L1 users)</span>
          <input
            data-testid="chat-gateway-allowlist"
            value={allowlist}
            onChange={(e) => markDirty(setAllowlist)(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <span className={label}>Admins (L2 bind)</span>
          <input
            data-testid="chat-gateway-admins"
            value={admins}
            onChange={(e) => markDirty(setAdmins)(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <span className={label}>Group channels (L4 opt-in)</span>
          <input
            data-testid="chat-gateway-group-channels"
            value={groupChannels}
            onChange={(e) => markDirty(setGroupChannels)(e.target.value)}
            className={field}
          />
        </div>
      </div>

      <div>
        <span className={label}>Steer prefix (mid-turn override)</span>
        <input
          data-testid="chat-gateway-steer-prefix"
          value={steerPrefix}
          onChange={(e) => markDirty(setSteerPrefix)(e.target.value)}
          className={`${field} max-w-[8rem]`}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="chat-gateway-save"
          disabled={busy}
          onClick={() => void save()}
          className="px-2 py-1 rounded border border-[var(--border-secondary)] text-xs hover:bg-[var(--bg-secondary)] disabled:opacity-50"
        >
          Save
        </button>
        {notice && (
          <span
            data-testid="chat-gateway-notice"
            className={`text-[11px] ${notice.kind === "ok" ? "text-[var(--text-secondary)]" : "text-[var(--danger-text,var(--text-secondary))]"}`}
          >
            {notice.text}
          </span>
        )}
      </div>

      <div>
        <span className={label}>Pairing (L1)</span>
        <span data-testid="chat-gateway-pairing-hint" className="text-[11px] text-[var(--text-tertiary)]">
          A DM from an unknown user is paired only when it matches the current pairing code.
          The code is printed to the server log at gateway startup (never returned over the API).
        </span>
      </div>

      <div>
        <span className={label}>Bindings</span>
        {bindings && bindings.bindings.length > 0 ? (
          <table data-testid="chat-gateway-bindings" className="w-full text-[11px]">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-left">
                <th className="font-normal">channel</th>
                <th className="font-normal">session</th>
                <th className="font-normal">cwd</th>
                <th className="font-normal">source</th>
              </tr>
            </thead>
            <tbody>
              {bindings.bindings.map((b) => (
                <tr key={`${b.platform}:${b.channelId}:${b.threadId ?? "-"}`}>
                  <td className="truncate max-w-[8rem]">{b.channelId}</td>
                  <td className="truncate max-w-[8rem]">{b.sessionId}</td>
                  <td className="truncate max-w-[12rem]">{b.cwd}</td>
                  <td>{b.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span data-testid="chat-gateway-bindings-empty" className="text-[11px] text-[var(--text-tertiary)]">
            {bindings ? "No bound channels." : "Bindings appear once the gateway is configured and running."}
          </span>
        )}
      </div>
    </div>
  );
}
