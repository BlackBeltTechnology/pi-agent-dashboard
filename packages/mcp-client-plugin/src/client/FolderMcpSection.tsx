/**
 * FolderMcpSection — `sidebar-folder-section` + `worktree-card-section` claim.
 *
 * ONE compact pill per folder cwd: the effective server count, the disabled
 * count when non-zero (warning colour), and an error marker (error colour)
 * whose accessible name names the failing path or the adapter timeout. While
 * the effective view loads it renders a muted placeholder of the same height
 * rather than an empty slot. Activating it opens `/folder/<encodedCwd>/mcp`
 * through the same wouter navigation the kb-plugin pill uses; `placement`
 * picks the raised (sidebar) or flat (worktree card) surface.
 *
 * A cwd outside the host's known-folder set is refused by the server (403) and
 * rendered as a muted "not tracked" state. That refusal is cached per cwd in
 * the effective-config store, so a remount never re-asks; the cache is dropped
 * when the host's session list changes (a folder can become known), which is
 * also the moment the pill retries. See change: extract-mcp-client-plugin
 * (tasks 8.1, 8.3).
 */
import {
  SlotPill,
  useAllSessions,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  FolderDescriptor,
  SlotPlacement,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiServerOutline } from "@mdi/js";
import type React from "react";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ApiError } from "./api.js";
import { invalidateEffective, useEffectiveConfig } from "./hooks.js";

export interface FolderMcpSectionProps {
  folder?: FolderDescriptor;
  placement?: SlotPlacement;
}

type Translate = ReturnType<typeof useT>;

export function folderMcpUrl(cwd: string): string {
  return `/folder/${encodeURIComponent(cwd)}/mcp`;
}

function ErrorMarker({ name }: { name: string }): React.ReactElement {
  return (
    <span
      data-testid="mcp-folder-pill-error"
      role="img"
      aria-label={name}
      className="text-red-400 flex-none"
    >
      ⚠
    </span>
  );
}

/**
 * Retry hook for a cached 403: the session list is the signal that a folder
 * may have become known, so a change drops the refusal and forces one request.
 */
function useSessionRetry(cwd: string | undefined, error: unknown, reload: () => void): void {
  const sessions = useAllSessions();
  const signature = sessions.map((s) => s.id).join("|");
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    if (error instanceof ApiError && error.isNotAllowed) {
      invalidateEffective(cwd);
      reload();
    }
  }, [signature, cwd, error, reload]);
}

interface PillContent {
  accent: "indigo" | "red";
  body: React.ReactNode;
}

interface PillState {
  timeout: ApiError | null;
  parseErrorPath: string | undefined;
  otherError: Error | null;
  notAllowed: boolean;
  loading: boolean;
  hasView: boolean;
  count: number;
  off: number;
}

function pillContent(t: Translate, state: PillState): PillContent {
  if (state.timeout) {
    const ms = state.timeout.timeoutMs ?? 10000;
    return {
      accent: "red",
      body: (
        <ErrorMarker
          name={t("mcpFolderTimeoutAria", { ms }, `MCP config timed out after ${ms} ms`)}
        />
      ),
    };
  }
  if (state.parseErrorPath !== undefined) {
    const path = state.parseErrorPath;
    return {
      accent: "red",
      body: (
        <ErrorMarker
          name={t("mcpFolderParseErrorAria", { path }, `MCP config failed to parse: ${path}`)}
        />
      ),
    };
  }
  if (state.otherError) {
    const message = state.otherError.message;
    return {
      accent: "red",
      body: (
        <ErrorMarker name={t("mcpFolderErrorAria", { message }, `MCP config error: ${message}`)} />
      ),
    };
  }
  if (state.notAllowed) {
    return {
      accent: "indigo",
      body: (
        <span
          data-testid="mcp-folder-pill-not-tracked"
          className="text-[var(--text-tertiary)] font-medium"
        >
          {t("mcpFolderNotTracked", undefined, "not tracked")}
        </span>
      ),
    };
  }
  if (state.loading && !state.hasView) {
    return {
      accent: "indigo",
      body: (
        <span
          data-testid="mcp-folder-pill-loading"
          className="inline-block h-[15px] w-16 rounded bg-[var(--bg-tertiary,#27272a)] animate-pulse"
        />
      ),
    };
  }
  return {
    accent: "indigo",
    body: (
      <>
        <span data-testid="mcp-folder-pill-count" className="tabular-nums">
          {state.count === 1
            ? t("mcpFolderServerOne", undefined, "1 server")
            : t("mcpFolderServerCount", { count: state.count }, `${state.count} servers`)}
        </span>
        {state.off > 0 && (
          <>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span data-testid="mcp-folder-pill-off" className="text-amber-400">
              {t("mcpFolderOffCount", { count: state.off }, `${state.off} off`)}
            </span>
          </>
        )}
      </>
    ),
  };
}

export function FolderMcpSection({
  folder,
  placement = "sidebar",
}: FolderMcpSectionProps): React.ReactElement | null {
  const t = useT();
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const { view, loading, error, reload } = useEffectiveConfig(cwd);
  useSessionRetry(cwd, error, reload);

  if (!cwd) return null;

  const notAllowed = error instanceof ApiError && error.isNotAllowed;
  const timeout = error instanceof ApiError && error.isAdapterTimeout ? error : null;
  const otherError = error && !notAllowed && !timeout ? (error as Error) : null;
  const servers = view?.servers ?? [];
  const { accent, body } = pillContent(t, {
    timeout,
    parseErrorPath: view?.layerErrors[0]?.path,
    otherError,
    notAllowed,
    loading,
    hasView: view !== null,
    count: servers.length,
    off: servers.filter((s) => s.entry.disabled === true).length,
  });

  return (
    <SlotPill
      surface={placement === "card" ? "flat" : "raised"}
      glyph={mdiServerOutline}
      accent={accent}
      label={t("mcpFolderPillLabel", undefined, "MCP")}
      activateTestId="mcp-folder-pill"
      activateTitle={t("mcpFolderPillTitle", undefined, "MCP servers for this folder")}
      onActivate={() => navigate(folderMcpUrl(cwd))}
    >
      {body}
    </SlotPill>
  );
}
