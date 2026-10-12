/**
 * Thin slot-claim components (the generated registry imports these statically,
 * so the heavy atlas page is lazy-loaded behind its own Suspense to keep it out
 * of the cold index chunk).
 *  - `SkillAtlasSection`  → `resource-page-section` (resourceType skill)
 *  - `SkillAtlasSettings` → `settings-section` promoted into Settings ▸ Resources
 *  - `FolderAtlasMenu`    → `sidebar-folder-section`: registers the folder
 *    actions menu item, renders nothing
 *  - `ProjectAtlasClaim` / `GlobalAtlasClaim` → `shell-overlay-route`
 * See change: add-skill-atlas-screen (design D6/D7).
 */
import { useFolderMenuItem, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor, SlotPlacement } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiGraphOutline } from "@mdi/js";
import type React from "react";
import { lazy, Suspense, useMemo } from "react";
import { useLocation } from "wouter";
import { atlasUrl, decodeFolderPath } from "./atlas-api.js";
import { AtlasSummary } from "./AtlasSummary.js";

const SkillAtlasPage = lazy(() => import("./SkillAtlasPage.js"));

export function SkillAtlasSection({ scope, cwd }: { scope: "folder" | "global"; cwd?: string }): React.ReactElement | null {
  return scope === "folder" && cwd ? <AtlasSummary scope="project" cwd={cwd} /> : <AtlasSummary scope="global" />;
}

export function SkillAtlasSettings(): React.ReactElement | null {
  return <AtlasSummary scope="global" />;
}

export function FolderAtlasMenu({ folder, placement }: { folder: FolderDescriptor; placement?: SlotPlacement }): null {
  const t = useT();
  const [, navigate] = useLocation();
  const cwd = folder?.cwd;
  const label = t("menuItem", undefined, "Skill Atlas");
  useFolderMenuItem(
    placement === "card" || !cwd ? null : cwd,
    useMemo(
      () =>
        cwd
          ? { id: "skill-atlas", group: "open" as const, label, icon: mdiGraphOutline, onSelect: () => navigate(atlasUrl("project", cwd)) }
          : null,
      [cwd, label, navigate],
    ),
  );
  return null;
}

function PageFallback(): React.ReactElement {
  const t = useT();
  return (
    <div className="p-4 text-[12px] text-[var(--text-secondary)]" aria-busy="true">
      {t("loading", undefined, "Loading skills…")}
    </div>
  );
}

export function ProjectAtlasClaim({ params, onBack }: { params: Record<string, string>; onBack: () => void }): React.ReactElement {
  const t = useT();
  const cwd = decodeFolderPath(params.encodedCwd ?? "");
  if (!cwd) {
    return (
      <div role="alert" className="p-4 text-[12px] text-[var(--severity-error-fg)]">
        {t("badFolder", undefined, "Invalid folder path.")}
      </div>
    );
  }
  return (
    <Suspense fallback={<PageFallback />}>
      <SkillAtlasPage scope="project" cwd={cwd} onBack={onBack} />
    </Suspense>
  );
}

export function GlobalAtlasClaim({ onBack }: { onBack: () => void }): React.ReactElement {
  return (
    <Suspense fallback={<PageFallback />}>
      <SkillAtlasPage scope="global" onBack={onBack} />
    </Suspense>
  );
}
