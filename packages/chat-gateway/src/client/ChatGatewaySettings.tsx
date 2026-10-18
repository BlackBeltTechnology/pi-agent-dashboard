/**
 * chat-gateway — dashboard plugin client entry (settings-section, task 10.1).
 *
 * Edits the gateway config through the canonical partial-write lane
 * (`plugin_config_write` → `POST /api/config/plugins/chat-gateway`), which
 * shallow-merges. The page buffers its edits into the host Save bar (draft
 * source `plugin:chat-gateway`, no Save button of its own) and commits ONLY the
 * keys the operator edited, so a key it does not own is never overwritten by a
 * stale snapshot.
 *
 * The bot TOKEN is write-only: the draft holds just a "replace token" string,
 * cleared after a commit / Discard / reset, never sent blank, never echoed from
 * the server, and scrubbed out of every error text and "Copy details" payload.
 *
 * The bindings table is read-only and fetched from the plugin's own
 * `/api/chat-gateway/bindings` route (registered only when configured).
 *
 * See change: add-chat-gateway, retro-ux-plugin-settings-wave-2.
 */

import {
  SelectField,
  SettingsGroup,
  SettingsNotice,
  SettingsStatusPill,
  SettingsTable,
  TextAreaField,
  TextField,
  ToggleField,
  useSettingsDraftSource,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type React from "react";
import { useEffect, useState } from "react";
import type { Binding, ChatGatewayConfig } from "../shared/types.js";
import { TeamControlsPanel } from "./team-controls-panel.js";

interface BindingsResponse {
  bindings: Binding[];
  status: { running: boolean; boundChannels: number; pendingSpawns: number };
}

/** Editable form values, kept as the strings the operator types. */
interface Draft {
  enabled: boolean;
  threadPerConversation: boolean;
  mirrorDashboardSessions: boolean;
  allowedRoots: string;
  defaultCwd: string;
  fixedMap: string;
  allowlist: string;
  admins: string;
  groupChannels: string;
  steerPrefix: string;
  sessionVisibility: "hidden" | "shown";
}

const INVALID_FIELDS = "Fix the invalid fields before saving.";
const SAVE_FAILED = "Couldn't save these settings. Your changes are still here.";

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

/** Split one `channelKey=cwd` line on its first `=`; `null` when malformed. */
function splitMapLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  const cwd = trimmed.slice(eq + 1).trim();
  return key.length > 0 && cwd.length > 0 ? [key, cwd] : null;
}

/** `channelKey=cwd` per line; the first `=` splits (cwd paths may contain none). */
function parseFixedMap(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const pair = splitMapLine(line);
    if (pair) out[pair[0]] = pair[1];
  }
  return out;
}

/** 1-based numbers of the non-blank lines that are not `channelKey=folder`. */
function badMapLines(value: string): number[] {
  const bad: number[] = [];
  value.split("\n").forEach((line, i) => {
    if (line.trim().length > 0 && !splitMapLine(line)) bad.push(i + 1);
  });
  return bad;
}

function mapLineError(bad: number[]): string | null {
  if (bad.length === 0) return null;
  return bad.length === 1
    ? `Line ${bad[0]} is not in the form channelKey=folder, so it would be dropped.`
    : `Lines ${bad.join(", ")} are not in the form channelKey=folder, so they would be dropped.`;
}

/**
 * Remove every spelling of a secret (raw, trimmed, JSON-escaped, URL-encoded)
 * from text that may be shown or copied. A server error can echo the request.
 */
function scrubSecret(text: string, secret: string): string {
  const spellings = new Set<string>();
  for (const s of [secret, secret.trim()]) {
    if (s.length === 0) continue;
    spellings.add(s);
    spellings.add(JSON.stringify(s).slice(1, -1));
    spellings.add(encodeURIComponent(s));
  }
  let out = text;
  for (const s of [...spellings].sort((a, b) => b.length - a.length)) out = out.split(s).join("[token hidden]");
  return out;
}

/** The saved config as editable form values (defaults mirror the server's). */
function savedDraft(config: ChatGatewayConfig | undefined): Draft {
  return {
    enabled: config?.enabled ?? true,
    threadPerConversation: config?.threadPerConversation ?? true,
    mirrorDashboardSessions: config?.mirrorDashboardSessions ?? false,
    allowedRoots: (config?.allowedRoots ?? []).join("\n"),
    defaultCwd: config?.defaultCwd ?? "",
    fixedMap: formatFixedMap(config?.fixedMap ?? {}),
    allowlist: (config?.allowlist ?? []).join(", "),
    admins: (config?.admins ?? []).join(", "),
    groupChannels: (config?.groupChannels ?? []).join(", "),
    steerPrefix: config?.steerPrefix ?? "!",
    sessionVisibility: config?.sessionVisibility ?? "hidden",
  };
}

/** Header pill: Not set up (no gateway route yet) · Paused · Running · Not running. */
function GatewayStatus({ bindings, enabled }: { bindings: BindingsResponse | null; enabled: boolean }): React.ReactElement {
  if (!bindings) {
    return (
      <SettingsStatusPill tone="neutral" status="not-set-up" testId="chat-gateway-status">
        Not set up · add a bot token
      </SettingsStatusPill>
    );
  }
  if (!enabled) {
    return (
      <SettingsStatusPill tone="neutral" icon={null} status="paused" testId="chat-gateway-status">
        Paused
      </SettingsStatusPill>
    );
  }
  return bindings.status.running ? (
    <SettingsStatusPill tone="success" status="running" testId="chat-gateway-status">
      Running
    </SettingsStatusPill>
  ) : (
    <SettingsStatusPill tone="warning" status="not-running" testId="chat-gateway-status">
      Not running
    </SettingsStatusPill>
  );
}

const WIRE: { [K in keyof Draft]: (v: Draft[K]) => unknown } = {
  enabled: (v) => v,
  threadPerConversation: (v) => v,
  mirrorDashboardSessions: (v) => v,
  allowedRoots: parseLines,
  defaultCwd: (v) => v,
  fixedMap: parseFixedMap,
  allowlist: parseList,
  admins: parseList,
  groupChannels: parseList,
  steerPrefix: (v) => v,
  sessionVisibility: (v) => v,
};

export function ChatGatewaySettings(_props: SlotProps<"settings-section">): React.ReactElement {
  const config = usePluginConfig<ChatGatewayConfig>();
  const send = usePluginSend();

  const saved = savedDraft(config);

  // Only the EDITED keys live in `draft`; every other field shows the saved
  // value, so a clean page adopts a `plugin_config_update` broadcast and a dirty
  // page keeps its edited keys while the rest adopt it.
  const [draft, setDraft] = useState<Partial<Draft>>({});
  // Write-only secret: the typed replacement only, never seeded from the server.
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ details: string } | null>(null);
  const [bindings, setBindings] = useState<BindingsResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const value: Draft = { ...saved, ...draft };
  const editedKeys = (Object.keys(draft) as Array<keyof Draft>).filter((k) => draft[k] !== saved[k]);
  const tokenTyped = token.trim().length > 0;
  const isDirty = editedKeys.length > 0 || tokenTyped;

  const mapError = mapLineError(badMapLines(value.fixedMap));
  const noAllowedFolders = parseLines(value.allowedRoots).length === 0;

  function edit<K extends keyof Draft>(key: K) {
    return (v: Draft[K]) => {
      setNotice(null);
      setDraft((d) => {
        const next = { ...d };
        if (v === saved[key]) delete next[key];
        else next[key] = v;
        return next;
      });
    };
  }

  // `refreshKey` re-reads the bindings after a successful commit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch trigger only.
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
  }, [refreshKey]);

  async function commit(): Promise<void> {
    if (mapError) throw new Error(INVALID_FIELDS);
    const partial: Record<string, unknown> = {};
    for (const key of editedKeys) partial[key] = (WIRE[key] as (v: unknown) => unknown)(value[key]);
    // A blank token means "keep the stored secret" — never send it, so a save
    // cannot erase the token by omission-through-the-form.
    if (tokenTyped) partial.token = token.trim();
    if (Object.keys(partial).length === 0) return;
    setBusy(true);
    try {
      await send({ type: "plugin_config_write", id: "chat-gateway", config: partial });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setNotice({ details: scrubSecret(raw, token) });
      // The host shows this message: a sentence, never the raw server text.
      throw new Error(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
    setToken("");
    setDraft({});
    setNotice(null);
    setRefreshKey((k) => k + 1);
  }

  function reset(): void {
    setToken("");
    setDraft({});
    setNotice(null);
  }

  useSettingsDraftSource({ id: "plugin:chat-gateway", isDirty, commit, reset });

  const configured = bindings !== null;
  return (
    <div className="space-y-3" data-testid="chat-gateway-settings">
      <div className="flex flex-wrap items-center gap-2">
        <GatewayStatus bindings={bindings} enabled={saved.enabled} />
      </div>
      <p className="text-xs text-[var(--text-secondary)]">Drive dashboard sessions from Discord.</p>

      {notice && (
        <SettingsNotice
          tone="error"
          testId="chat-gateway-notice"
          onRetry={() => void commit().catch(() => {})}
          retrying={busy}
          details={notice.details}
        >
          {SAVE_FAILED}
        </SettingsNotice>
      )}

      <SettingsGroup title="Discord connection" testId="chat-gateway-group-connection">
        <ToggleField
          label="Answer Discord messages"
          hint="Turn off to pause the gateway without losing its settings."
          value={value.enabled}
          onChange={edit("enabled")}
          testIds={{ control: "chat-gateway-enabled" }}
        />
        <TextField
          label="Bot token"
          type="password"
          autoComplete="off"
          hint={
            configured
              ? "A token is saved. Paste a new one to replace it."
              : "Create a bot in the Discord developer portal and paste its token. Without it the gateway does nothing."
          }
          placeholder={configured ? "•••••••• saved" : "Paste bot token"}
          value={token}
          onChange={(v) => {
            setNotice(null);
            setToken(v);
          }}
          testIds={{ control: "chat-gateway-token" }}
        />
      </SettingsGroup>

      <SettingsGroup title="Where sessions run" testId="chat-gateway-group-where">
        {noAllowedFolders && (
          <SettingsNotice tone="warning" testId="chat-gateway-allowed-roots-warning">
            No allowed folders yet, so no session can start. Add at least one folder.
          </SettingsNotice>
        )}
        <TextAreaField
          label="Allowed folders"
          hint="One folder per line. Every new session's folder must be inside one of these. Required."
          placeholder="/Users/you/Projects"
          rows={3}
          mono
          value={value.allowedRoots}
          onChange={edit("allowedRoots")}
          testIds={{ control: "chat-gateway-allowed-roots" }}
        />
        <TextField
          label="Default folder"
          hint="Used when a channel has no folder below. Must be inside an allowed folder."
          placeholder="/Users/you/Projects/app"
          mono
          value={value.defaultCwd}
          onChange={edit("defaultCwd")}
          testIds={{ control: "chat-gateway-default-cwd" }}
        />
        <TextAreaField
          label="Channel folders"
          hint={
            <>
              One <code>channelKey=folder</code> per line. Pins a channel to a folder.
            </>
          }
          placeholder="discord:123456789:-=/repos/proj"
          rows={3}
          mono
          value={value.fixedMap}
          onChange={edit("fixedMap")}
          error={mapError}
          testIds={{ control: "chat-gateway-fixed-map", error: "chat-gateway-fixed-map-error" }}
        />
      </SettingsGroup>

      <SettingsGroup title="Who can use it" defaultOpen={false} testId="chat-gateway-group-access">
        <TextField
          label="Allowed users"
          hint="Discord user ids, comma-separated. They can talk to sessions in direct messages."
          placeholder="123456789012345678"
          mono
          value={value.allowlist}
          onChange={edit("allowlist")}
          testIds={{ control: "chat-gateway-allowlist" }}
        />
        <TextField
          label="Admins"
          hint="Can also bind channels to sessions."
          mono
          value={value.admins}
          onChange={edit("admins")}
          testIds={{ control: "chat-gateway-admins" }}
        />
        <TextField
          label="Group channels"
          hint="Channel ids where the bot answers everyone, not only allowed users."
          mono
          value={value.groupChannels}
          onChange={edit("groupChannels")}
          testIds={{ control: "chat-gateway-group-channels" }}
        />
      </SettingsGroup>

      <SettingsGroup title="Behaviour" defaultOpen={false} testId="chat-gateway-group-behaviour">
        <ToggleField
          label="New thread per conversation"
          hint="A new channel message starts a new thread and a new session."
          value={value.threadPerConversation}
          onChange={edit("threadPerConversation")}
          testIds={{ control: "chat-gateway-thread-per-conversation" }}
        />
        <ToggleField
          label="Mirror dashboard sessions"
          hint="Every dashboard session gets its own Discord thread and sends its activity there."
          value={value.mirrorDashboardSessions}
          onChange={edit("mirrorDashboardSessions")}
          testIds={{ control: "chat-gateway-mirror-dashboard-sessions" }}
        />
        <TextField
          label="Steer prefix"
          hint="Start a message with this to interrupt a running turn."
          mono
          value={value.steerPrefix}
          onChange={edit("steerPrefix")}
          testIds={{ control: "chat-gateway-steer-prefix" }}
        />
        <SelectField
          label="Chat sessions on the board"
          hint="Hidden sessions appear when “Show hidden” is on."
          value={value.sessionVisibility}
          options={[
            { value: "hidden", label: "Hidden" },
            { value: "shown", label: "Shown" },
          ]}
          onChange={(v) => edit("sessionVisibility")(v as Draft["sessionVisibility"])}
          testIds={{ control: "chat-gateway-session-visibility" }}
        />
      </SettingsGroup>

      <SettingsNotice tone="info" testId="chat-gateway-pairing-hint">
        Pairing: a direct message from an unknown user is accepted only when it contains the current pairing
        code. The code is printed in the server log when the gateway starts.
      </SettingsNotice>

      <SettingsGroup
        title="Bound channels"
        meta={bindings && bindings.bindings.length > 0 ? String(bindings.bindings.length) : undefined}
        testId="chat-gateway-group-bindings"
      >
        {bindings && bindings.bindings.length > 0 ? (
          <SettingsTable
            testId="chat-gateway-bindings"
            caption="Bound channels"
            columns={["Channel", "Session", "Folder", "Source"]}
            rows={bindings.bindings.map((b) => ({
              key: `${b.platform}:${b.channelId}:${b.threadId ?? "-"}`,
              cells: [
                <span key="c" className="break-all">
                  {b.channelId}
                </span>,
                <span key="s" className="break-all">
                  {b.sessionId}
                </span>,
                <code key="f" className="break-all">
                  {b.cwd}
                </code>,
                b.source,
              ],
            }))}
          />
        ) : (
          <p data-testid="chat-gateway-bindings-empty" className="text-xs text-[var(--text-secondary)]">
            {bindings
              ? "No channels are bound yet. They appear here once the gateway is running."
              : "Bound channels appear here once the gateway is set up and running."}
          </p>
        )}
      </SettingsGroup>

      <TeamControlsPanel />
    </div>
  );
}
