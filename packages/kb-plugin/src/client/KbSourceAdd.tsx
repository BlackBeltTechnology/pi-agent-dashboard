/**
 * KbSourceAdd — add-a-source row for the KB settings page: kind toggle
 * (Folder | Git repo | URL), ref input, Browse… (folder picker), and the git
 * fields (pin / subdir / refresh).
 *
 * Validation lives here (Folder refuses URL-shaped input; one source per ref);
 * trust consent for remote kinds is the CALLER's job (the panel opens the trust
 * dialog from `onAdd`). Browse… renders only when the host registers
 * `ui:path-picker` (soft hook) — typing always works.
 *
 * See change: improve-kb-settings-sources-and-search (design D1, D3).
 */
import { useT, useUiPrimitiveOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { withTrailingSep } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { mdiFolderOpenOutline, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import type { SourceConfig } from "../shared/kb-plugin-types.js";
import { detectGitRef, refuseSource, type SourceRefusal, type SourceUiKind, toSourceRef } from "./source-ref.js";

/** Soft lookup that also tolerates a missing provider (older host / bare test render). */
function usePathPickerPrimitive() {
  try {
    return useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.pathPicker);
  } catch {
    return null;
  }
}

type RefreshChoice = "manual" | "on-index" | "daily";

const REFRESH_SPEC: Record<RefreshChoice, NonNullable<SourceConfig["refresh"]>> = {
  manual: "manual",
  "on-index": "on-index",
  daily: { ttlMs: 86_400_000 },
};

export interface KbSourceAddProps {
  cwd: string;
  /** Refs already in the form — one source per ref. */
  existingRefs: string[];
  onAdd: (spec: SourceConfig) => void;
}

const inputCls =
  "text-[12px] font-mono bg-transparent border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-secondary)] focus:outline-none focus:border-indigo-500/60";

export function KbSourceAdd({ cwd, existingRefs, onAdd }: KbSourceAddProps): React.ReactElement {
  const t = useT();
  const PathPickerDialog = usePathPickerPrimitive();
  const [kind, setKind] = useState<SourceUiKind>("filesystem");
  const [input, setInput] = useState("");
  const [pin, setPin] = useState("");
  const [subdir, setSubdir] = useState("");
  const [refresh, setRefresh] = useState<RefreshChoice>("manual");
  const [hint, setHint] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const reset = (): void => {
    setInput("");
    setPin("");
    setSubdir("");
    setRefresh("manual");
    setHint(null);
  };

  const hintFor = (r: SourceRefusal): string => {
    switch (r) {
      case "npm":
        return t("hintNpm", undefined, "npm sources are not added from the UI.");
      case "remote-in-folder":
        return t("hintUseRemoteKind", undefined, "That looks like a remote source — choose Git repo or URL.");
      case "https-only":
        return t("hintHttpsOnly", undefined, "A URL source must start with https://.");
      default:
        return t(
          "hintOneRefOneRoot",
          undefined,
          "One ref is one index root — change the existing source's pin/subdir instead.",
        );
    }
  };

  const commit = (rawRef: string, asKind: SourceUiKind): void => {
    const ref = rawRef.trim();
    if (!ref) return;
    const refusal = refuseSource(ref, asKind, existingRefs);
    if (refusal) {
      setHint(hintFor(refusal));
      return;
    }
    const spec: SourceConfig = { kind: asKind, ref, priority: 0 };
    if (asKind === "git") {
      if (pin.trim()) spec.pin = pin.trim();
      if (subdir.trim()) spec.subdir = subdir.trim();
      spec.refresh = REFRESH_SPEC[refresh];
    }
    onAdd(spec);
    reset();
  };

  const onInput = (v: string): void => {
    setInput(v);
    setHint(null);
    if (kind === "filesystem" && detectGitRef(v)) setKind("git");
  };

  const kinds: Array<{ id: SourceUiKind; label: string }> = [
    { id: "filesystem", label: t("kindFolder", undefined, "Folder") },
    { id: "git", label: t("kindGit", undefined, "Git repo") },
    { id: "https", label: t("kindUrl", undefined, "URL") },
  ];

  return (
    <div className="mt-1" data-testid="kb-source-add-form">
      <div className="flex items-center gap-1.5">
        <div
          role="group"
          aria-label={t("sourceKind", undefined, "Source kind")}
          className="flex rounded border border-[var(--border-subtle)] overflow-hidden"
        >
          {kinds.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
              data-testid={`kb-source-kind-${k.id}`}
              onClick={() => {
                setKind(k.id);
                setHint(null);
              }}
              className={`text-[11px] px-2 py-1 ${kind === k.id ? "bg-indigo-500/20 text-indigo-200" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(input, kind);
            }
          }}
          placeholder={
            kind === "filesystem"
              ? t("sourcePlaceholder", undefined, "path relative to folder, e.g. docs")
              : kind === "git"
                ? t("gitPlaceholder", undefined, "https://github.com/org/repo")
                : t("urlPlaceholder", undefined, "https://example.com/docs.md or .tar.gz / .zip")
          }
          data-testid="kb-source-input"
          className={`flex-1 ${inputCls}`}
        />
        {kind === "filesystem" && PathPickerDialog && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            data-testid="kb-source-browse"
            className="text-[11px] px-2 py-1 rounded border text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-indigo-500/60 flex items-center gap-1"
          >
            <Icon path={mdiFolderOpenOutline} size={0.5} />
            {t("browse", undefined, "Browse…")}
          </button>
        )}
        <button
          type="button"
          onClick={() => commit(input, kind)}
          data-testid="kb-source-add"
          className="text-[11px] px-2 py-1 rounded border text-indigo-400 border-indigo-500/40 bg-indigo-500/5 hover:border-indigo-500/70 flex items-center gap-1"
        >
          <Icon path={mdiPlus} size={0.5} />
          {t("addSource", undefined, "Add")}
        </button>
      </div>

      {kind === "git" && (
        <div className="flex items-center gap-1.5 mt-1.5" data-testid="kb-source-git-fields">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={t("pinPlaceholder", undefined, "branch or tag (optional)")}
            data-testid="kb-source-pin"
            className={`w-44 ${inputCls}`}
          />
          <input
            value={subdir}
            onChange={(e) => setSubdir(e.target.value)}
            placeholder={t("subdirPlaceholder", undefined, "subdir (optional)")}
            data-testid="kb-source-subdir"
            className={`w-40 ${inputCls}`}
          />
          <select
            value={refresh}
            onChange={(e) => setRefresh(e.target.value as RefreshChoice)}
            data-testid="kb-source-refresh"
            className={inputCls}
          >
            <option value="manual">{t("refreshManual", undefined, "refresh: manual")}</option>
            <option value="on-index">{t("refreshOnIndex", undefined, "refresh: on every index")}</option>
            <option value="daily">{t("refreshDaily", undefined, "refresh: daily")}</option>
          </select>
        </div>
      )}
      {kind === "https" && (
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
          {t("urlHint", undefined, "A single .md file, or a .tar.gz / .tgz / .zip archive.")}
        </div>
      )}
      {hint && (
        <div className="mt-1 text-[11px] text-amber-400" role="alert" data-testid="kb-source-hint">
          {hint}
        </div>
      )}

      {PathPickerDialog && picking && (
        <PathPickerDialog
          open
          // Trailing separator → the picker opens INSIDE the folder (without it, it lists the parent filtered by the leaf).
          initialPath={withTrailingSep(cwd, cwd.includes("\\") && !cwd.includes("/") ? "win32" : "linux")}
          title={t("chooseFolder", undefined, "Choose a folder to index")}
          onCancel={() => setPicking(false)}
          onSelect={(abs) => {
            setPicking(false);
            commit(toSourceRef(cwd, abs).ref, "filesystem");
          }}
        />
      )}
    </div>
  );
}
