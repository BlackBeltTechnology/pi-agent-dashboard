/**
 * OpenSpec Workflow Profile settings section.
 *
 * Lets the user set the GLOBAL OpenSpec profile (core / expanded / custom)
 * from the dashboard, then explicitly refresh projects via `openspec update`
 * (per-cwd or all). Save writes only the global config — it never mutates a
 * project repo. A collapsible per-cwd list shows staleness so the user knows
 * which projects lag the current profile.
 *
 * See change: add-openspec-profile-settings.
 */

import { useSettingsDraftSource } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  CORE_WORKFLOWS,
  EXPANDED_WORKFLOWS,
  type OpenSpecConfig,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  type CwdUpdateStatus,
  fetchGlobalOpenSpecConfig,
  fetchUpdateStatus,
  runOpenSpecUpdate,
  saveOpenSpecConfig,
} from "../../lib/openspec/openspec-config-api.js";

type Profile = OpenSpecConfig["profile"];
type LoadStatus = "loading" | "ready" | "error";

const ALL_WORKFLOWS = [...EXPANDED_WORKFLOWS];
/** Transient-failure retry budget + backoff for the initial config load. */
const LOAD_MAX_ATTEMPTS = 2;
const LOAD_RETRY_DELAY_MS = 300;

const STATUS_LABEL: Record<CwdUpdateStatus["status"], string> = {
  "up-to-date": "up to date",
  "needs-update": "needs update",
  "unknown": "unknown",
};

export function OpenSpecProfileSection() {
  // No concrete profile is "selected" until the real global config resolves —
  // a hardcoded default would strand the UI on the wrong profile when the load
  // fails. See change: fix-openspec-profile-load-race.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workflows, setWorkflows] = useState<string[]>([...CORE_WORKFLOWS]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  // Once the user picks a profile, a late-arriving load must not clobber it.
  const userTouched = useRef(false);
  // Loaded-config baseline for unified-Save dirty detection.
  // See change: unify-settings-save-contract.
  const [baselineProfile, setBaselineProfile] = useState<Profile | null>(null);
  const [baselineWorkflows, setBaselineWorkflows] = useState<string[]>([...CORE_WORKFLOWS]);
  const [statuses, setStatuses] = useState<CwdUpdateStatus[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null); // cwd or "__all__"

  const refreshStatus = useCallback(async () => {
    try {
      setStatuses(await fetchUpdateStatus());
    } catch {
      /* tolerate */
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Initialize controls from the CURRENT global config so the section reflects
  // the saved profile (not a hardcoded default). A transient failure is retried
  // and, if it ultimately fails, surfaced as an error with a manual retry —
  // never silently swallowed into a hardcoded `core`.
  // See change: fix-openspec-profile-load-race.
  const loadConfig = useCallback(async () => {
    // No early-return guards: every path commits a terminal state (ready/error)
    // so a transient failure or a fast remount can never strand the UI on
    // "loading". A late setState on an unmounted instance is a harmless no-op in
    // React 18; the userTouched ref alone protects an in-progress user choice.
    setLoadStatus("loading");
    for (let attempt = 1; attempt <= LOAD_MAX_ATTEMPTS; attempt++) {
      try {
        const cfg = await fetchGlobalOpenSpecConfig();
        const loadedProfile =
          cfg.profile === "core" || cfg.profile === "expanded" || cfg.profile === "custom" ? cfg.profile : null;
        const loadedWorkflows = Array.isArray(cfg.workflows) && cfg.workflows.length > 0 ? cfg.workflows : null;
        if (loadedProfile) setBaselineProfile(loadedProfile);
        if (loadedWorkflows) setBaselineWorkflows(loadedWorkflows);
        if (!userTouched.current) {
          if (loadedProfile) setProfile(loadedProfile);
          if (loadedWorkflows) setWorkflows(loadedWorkflows);
        }
        setLoadStatus("ready");
        return;
      } catch {
        if (attempt < LOAD_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, LOAD_RETRY_DELAY_MS));
          continue;
        }
        setLoadStatus("error");
        return;
      }
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  function selectProfile(p: Profile) {
    userTouched.current = true;
    setProfile(p);
    if (p === "core") setWorkflows([...CORE_WORKFLOWS]);
    else if (p === "expanded") setWorkflows([...EXPANDED_WORKFLOWS]);
    // custom: leave the current selection so the user can tweak it
  }

  function toggleWorkflow(wf: string) {
    if (profile !== "custom") return;
    userTouched.current = true;
    setWorkflows((prev) => (prev.includes(wf) ? prev.filter((w) => w !== wf) : [...prev, wf]));
  }

  // Buffered source: profile/workflows persist via the unified Settings Save
  // (no standalone "Save profile" button). See change:
  // unify-settings-save-contract.
  const isDirty =
    baselineProfile !== null &&
    profile !== null &&
    (profile !== baselineProfile || JSON.stringify(workflows) !== JSON.stringify(baselineWorkflows));
  const profileRef = useRef(profile); profileRef.current = profile;
  const workflowsRef = useRef(workflows); workflowsRef.current = workflows;
  const baseProfileRef = useRef(baselineProfile); baseProfileRef.current = baselineProfile;
  const baseWfRef = useRef(baselineWorkflows); baseWfRef.current = baselineWorkflows;
  const commit = useCallback(async () => {
    if (profileRef.current === null) return;
    await saveOpenSpecConfig(profileRef.current, workflowsRef.current);
    setBaselineProfile(profileRef.current);
    setBaselineWorkflows([...workflowsRef.current]);
    userTouched.current = false;
    await refreshStatus();
  }, [refreshStatus]);
  const reset = useCallback(() => {
    if (baseProfileRef.current !== null) setProfile(baseProfileRef.current);
    setWorkflows([...baseWfRef.current]);
    userTouched.current = false;
  }, []);
  useSettingsDraftSource({ id: "openspec-profile", page: "openspec", isDirty, commit, reset });

  async function handleUpdate(target: { cwd: string } | { all: true }) {
    setUpdating("all" in target ? "__all__" : target.cwd);
    try {
      await runOpenSpecUpdate(target);
      await refreshStatus();
    } catch {
      /* tolerate */
    } finally {
      setUpdating(null);
    }
  }

  const staleCount = statuses.filter((s) => s.status !== "up-to-date").length;

  return (
    <div data-testid="openspec-profile-settings">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 pb-1 border-b border-[var(--border-secondary)]">
        {i18nT("openspec.openspecWorkflowProfile", undefined, "OpenSpec Workflow Profile")}
      </h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        {i18nT("common.controlsWhich", undefined, "Controls which")} <code>/opsx:</code> {i18nT("session.workflowButtonsAppearOnSessionCards", undefined, "workflow buttons appear on session cards and the composer.")}
      </p>

      {loadStatus === "loading" && (
        <p className="text-[11px] text-[var(--text-muted)] mb-2" data-testid="profile-loading">
          {i18nT("status.loadingCurrentProfile", undefined, "Loading current profile…")}
        </p>
      )}
      {loadStatus === "error" && (
        <div
          className="mb-2 flex items-center gap-2 p-2.5 rounded border border-red-500/30 bg-red-500/[0.06] text-[11px] text-red-400"
          data-testid="profile-error"
        >
          <span aria-hidden="true">⚠️</span>
          <span className="flex-1">{i18nT("common.couldnTLoadTheCurrentProfile", undefined, "Couldn’t load the current profile.")}</span>
          <button
            type="button"
            data-testid="profile-load-retry"
            onClick={() => loadConfig()}
            className="px-2 py-1 rounded border border-red-500/40 text-red-300"
          >
            {i18nT("common.retry", undefined, "Retry")}
          </button>
        </div>
      )}

      {/* Profile radios */}
      <div className="space-y-2" data-testid="profile-options">
        <ProfileOption
          id="core" label={i18nT("common.core", undefined, "Core")} selected={profile === "core"}
          flows="propose · explore · apply · archive"
          onSelect={() => selectProfile("core")}
        />
        <ProfileOption
          id="expanded" label={i18nT("common.expanded", undefined, "Expanded")} selected={profile === "expanded"}
          flows="core + new · continue · ff · verify · sync · bulk-archive · onboard"
          onSelect={() => selectProfile("expanded")}
        />
        <ProfileOption
          id="custom" label={i18nT("common.custom", undefined, "Custom")} selected={profile === "custom"}
          flows="pick any subset"
          onSelect={() => selectProfile("custom")}
        >
          <div
            className={`mt-2 flex flex-wrap gap-1.5 ${profile === "custom" ? "" : "opacity-40 pointer-events-none"}`}
            data-testid="workflow-multiselect"
          >
            {ALL_WORKFLOWS.map((wf) => {
              const on = workflows.includes(wf);
              return (
                <button
                  key={wf}
                  type="button"
                  data-testid={`wf-chip-${wf}`}
                  data-on={on}
                  onClick={(e) => { e.stopPropagation(); toggleWorkflow(wf); }}
                  className={`text-[11px] px-2 py-1 rounded border ${
                    on
                      ? "text-blue-400 border-blue-500/50 bg-blue-500/8"
                      : "text-[var(--text-tertiary)] border-[var(--border-secondary)]"
                  }`}
                >
                  {on ? "✓ " : ""}{wf}
                </button>
              );
            })}
          </div>
        </ProfileOption>
      </div>

      {/* Warning banner */}
      <div className="mt-3 flex items-start gap-2 p-2.5 rounded border border-yellow-500/30 bg-yellow-500/[0.06] text-[11px] text-yellow-400 leading-relaxed">
        <span aria-hidden="true">⚠️</span>
        <span>
          {i18nT("common.thisChangesThe", undefined, "This changes the")} <b className="text-[var(--text-primary)]">global</b> OpenSpec config for every tool on this machine
          (Claude Code, Cursor, the CLI). Saving does not touch project files — use the Update buttons below to regenerate
          a project's <code>/opsx:</code> {i18nT("common.skillFiles", undefined, "skill files.")}
        </span>
      </div>

      {/* Projects: update-all + collapsible per-cwd list */}
      <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid="update-all-btn"
            disabled={updating !== null}
            onClick={() => handleUpdate({ all: true })}
            className="text-xs px-3 py-1.5 rounded text-cyan-400 border border-cyan-500/40 bg-cyan-500/[0.06] disabled:opacity-50"
          >
            {updating === "__all__" ? "Updating…" : "↻ Update all projects"}
          </button>
          {staleCount > 0 && (
            <span className="text-[11px] text-orange-400">{staleCount} of {statuses.length} {i18nT("common.projectsNeedUpdate", undefined, "projects need update")}</span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            data-testid="collapse-toggle"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] px-2 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
          >
            {expanded ? "▾ Hide projects" : "▸ Show projects"}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 space-y-1.5" data-testid="cwd-list">
            {statuses.length === 0 && (
              <p className="text-[11px] text-[var(--text-muted)]">{i18nT("common.noKnownProjects", undefined, "No known projects.")}</p>
            )}
            {statuses.map((s) => {
              const fresh = s.status === "up-to-date";
              return (
                <div
                  key={s.cwd}
                  data-testid={`cwd-row-${s.cwd}`}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded border bg-[var(--bg-tertiary)] ${
                    fresh ? "border-[var(--border-subtle)]" : "border-orange-500/30"
                  }`}
                >
                  <span
                    data-testid={`status-badge-${s.cwd}`}
                    className={`text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full border ${
                      fresh
                        ? "text-green-400 border-green-500/30 bg-green-500/8"
                        : s.status === "needs-update"
                          ? "text-orange-400 border-orange-500/35 bg-orange-500/8"
                          : "text-[var(--text-muted)] border-[var(--border-secondary)]"
                    }`}
                  >
                    {fresh ? "✓ " : ""}{STATUS_LABEL[s.status]}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-secondary)] truncate">{s.cwd}</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    data-testid={`update-btn-${s.cwd}`}
                    disabled={fresh || updating !== null}
                    onClick={() => handleUpdate({ cwd: s.cwd })}
                    className="text-[10px] px-2 py-1 rounded text-cyan-400 border border-cyan-500/40 bg-cyan-500/[0.06] disabled:opacity-35"
                  >
                    {updating === s.cwd ? "Updating…" : "↻ Update"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileOption({
  id, label, flows, selected, onSelect, children,
}: {
  id: string;
  label: string;
  flows: string;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid={`profile-option-${id}`}
      data-selected={selected}
      onClick={onSelect}
      className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer ${
        selected ? "border-blue-500 bg-blue-500/[0.06]" : "border-[var(--border-secondary)]"
      }`}
    >
      <span
        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
          selected ? "border-blue-400" : "border-[var(--border-primary)]"
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-blue-400" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</div>
        <div className="text-[10px] text-[var(--text-tertiary)] font-mono">{flows}</div>
        {children}
      </div>
    </div>
  );
}
