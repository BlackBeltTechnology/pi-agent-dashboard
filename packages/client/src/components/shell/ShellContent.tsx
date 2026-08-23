/**
 * The shell's route-derived content region (design D1, option C).
 *
 * WHY THIS COMPONENT EXISTS. A route-backed overlay renders the launching
 * surface beneath it from a FROZEN path, via a nested wouter `<Router>`. That
 * only works if the branch selection re-derives *inside* that Router. While
 * every `useRoute` call lived in `App`'s body the selection was already fixed
 * against the live (overlay) URL before the subtree was handed down, so a
 * frozen Router underneath could not change it — the underlay fell through to
 * `LandingPage` no matter what the background was.
 *
 * So the route derivations move here, and `App` keeps the state and handlers,
 * passing them as `renderX` callbacks parameterised by the resolved route
 * params. `App` renders this once live; a `RouteBackedOverlay` renders the SAME
 * element again as its `backgroundContent`, where these hooks resolve against
 * the frozen location instead.
 *
 * `variant` exists because the desktop and mobile chains are NOT the same
 * chain: mobile carries `/session/:id/diff` as its own branch and desktop
 * reaches diff through `selectedId`, desktop guards several branches with
 * `!selectedId` and mobile does not, and desktop renders the folder editor from
 * a separate block above this region. That divergence is pre-existing and this
 * component reproduces it exactly rather than unifying it — unifying is a
 * behaviour change and does not belong in this refactor.
 *
 * Overlay surfaces (`/settings`, `/tunnel-setup`, plugin claims) are
 * deliberately NOT owned here; they render in the overlay layer above.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import type { ReactNode } from "react";
import { useRoute, useSearchParams } from "wouter";
import { decodeFolderPath } from "../../lib/util/folder-encoding.js";

/** Folder-settings pages the shell will honour; anything else falls back. */
const VALID_FOLDER_SETTINGS_PAGES = [
  "instructions",
  "packages",
  "skills",
  "agents",
  "extensions",
  "prompts",
  "themes",
] as const;

// Not exported: only this module names it, and an unused export trips the
// knip ratchet. `ShellContentRenderers` still carries it structurally.
type FolderSettingsPage = (typeof VALID_FOLDER_SETTINGS_PAGES)[number];

export interface ShellContentRenderers {
  renderOpenSpecBoard: (cwd: string) => ReactNode;
  renderArchive: (cwd: string) => ReactNode;
  renderSpecs: (cwd: string) => ReactNode;
  renderDiff: (sessionId: string) => ReactNode;
  renderPiResourceFile: (path: string, title: string) => ReactNode;
  renderPiResourcesRedirect: (cwd: string) => ReactNode;
  renderFolderSettings: (cwd: string, page: FolderSettingsPage) => ReactNode;
  renderOpenSpecPreview: (cwd: string, changeName: string, artifactId: string) => ReactNode;
  renderFilePreview: (cwd: string, path: string) => ReactNode;
  renderUrlPreview: (url: string) => ReactNode;
  renderFolderEditor: (cwd: string) => ReactNode;
  renderFolderHome: (cwd: string) => ReactNode;
  /** Session chat, or `null` when the id is not a known session. */
  renderSession: (sessionId: string) => ReactNode;
  renderLanding: () => ReactNode;
}

interface Props extends ShellContentRenderers {
  variant: "desktop" | "mobile";
}

/**
 * Resolves the shell's content branch from the AMBIENT wouter location — live
 * in the normal tree, frozen when rendered as a `RouteBackedOverlay` underlay.
 */
export function ShellContent({ variant, ...render }: Props) {
  const [openspecPreviewMatch, openspecPreviewParams] = useRoute(
    "/folder/:encodedCwd/openspec/:changeName/:artifactId",
  );
  const [openspecBoardMatch, openspecBoardParams] = useRoute("/folder/:encodedCwd/openspec");
  const [archiveMatch, archiveParams] = useRoute("/folder/:encodedCwd/openspec/archive");
  const [specsMatch, specsParams] = useRoute("/folder/:encodedCwd/openspec/specs");
  const [piResourcesMatch, piResourcesParams] = useRoute("/folder/:encodedCwd/pi-resources");
  const [folderSettingsMatch, folderSettingsParams] = useRoute("/folder/:encodedCwd/settings/:page?");
  const [fileViewMatch, fileViewParams] = useRoute("/folder/:encodedCwd/view");
  const [urlViewMatch] = useRoute("/pi-view");
  const [piResourceFileMatch] = useRoute("/pi-resource");
  const [diffMatch, diffParams] = useRoute("/session/:id/diff");
  const [editorMatch, editorParams] = useRoute("/session/:id/editor");
  const [sessionMatch, sessionParams] = useRoute("/session/:id");
  const [folderHomeMatch, folderHomeParams] = useRoute("/folder/:encodedCwd");
  const [folderEditorMatch, folderEditorParams] = useRoute("/folder/:encodedCwd/editor");
  const [search] = useSearchParams();

  const urlViewUrl = urlViewMatch ? search.get("url") : null;
  const fileViewPath = fileViewMatch ? search.get("path") : null;
  const fileViewCwd = fileViewMatch && fileViewParams ? decodeFolderPath(fileViewParams.encodedCwd) : null;
  const piResourceFilePath = piResourceFileMatch ? search.get("path") : null;
  const piResourceFileTitle = search.get("title") ?? "";
  const openspecPreviewCwd =
    openspecPreviewMatch && openspecPreviewParams ? decodeFolderPath(openspecPreviewParams.encodedCwd) : null;
  const openspecBoardCwd =
    openspecBoardMatch && openspecBoardParams ? decodeFolderPath(openspecBoardParams.encodedCwd) : null;
  const archiveCwd = archiveMatch && archiveParams ? decodeFolderPath(archiveParams.encodedCwd) : null;
  const specsCwd = specsMatch && specsParams ? decodeFolderPath(specsParams.encodedCwd) : null;
  const piResourcesCwd = piResourcesMatch && piResourcesParams ? decodeFolderPath(piResourcesParams.encodedCwd) : null;
  const folderSettingsCwd =
    folderSettingsMatch && folderSettingsParams ? decodeFolderPath(folderSettingsParams.encodedCwd) : null;
  const folderHomeCwd = folderHomeMatch ? decodeFolderPath(folderHomeParams?.encodedCwd ?? "") : null;
  const folderEditorCwd = folderEditorMatch ? decodeFolderPath(folderEditorParams?.encodedCwd ?? "") : null;

  const folderSettingsPageRaw = folderSettingsMatch ? folderSettingsParams?.page : undefined;
  const folderSettingsPage: FolderSettingsPage =
    folderSettingsPageRaw && (VALID_FOLDER_SETTINGS_PAGES as readonly string[]).includes(folderSettingsPageRaw)
      ? (folderSettingsPageRaw as FolderSettingsPage)
      : "packages";

  // `selectedId` mirrors App's derivation: the diff and editor routes are
  // session surfaces too, so they select the same session.
  const selectedId =
    (sessionMatch ? sessionParams?.id : undefined) ??
    (diffMatch ? diffParams?.id : undefined) ??
    (editorMatch ? editorParams?.id : undefined);

  // Desktop guards a run of branches with `!selectedId`; mobile does not.
  const free = variant === "mobile" || !selectedId;

  if (openspecBoardMatch && openspecBoardCwd) return <>{render.renderOpenSpecBoard(openspecBoardCwd)}</>;
  if (archiveMatch && archiveCwd) return <>{render.renderArchive(archiveCwd)}</>;
  if (specsMatch && specsCwd) return <>{render.renderSpecs(specsCwd)}</>;
  // Desktop reaches diff through `selectedId` -> session chat, so it has no
  // diff branch of its own here.
  if (variant === "mobile" && diffMatch && diffParams?.id) return <>{render.renderDiff(diffParams.id)}</>;
  if (piResourceFileMatch && piResourceFilePath)
    return <>{render.renderPiResourceFile(piResourceFilePath, piResourceFileTitle)}</>;
  if (piResourcesMatch && piResourcesCwd && free) return <>{render.renderPiResourcesRedirect(piResourcesCwd)}</>;
  if (folderSettingsMatch && folderSettingsCwd && free)
    return <>{render.renderFolderSettings(folderSettingsCwd, folderSettingsPage)}</>;
  if (openspecPreviewMatch && openspecPreviewCwd && openspecPreviewParams && free)
    return (
      <>
        {render.renderOpenSpecPreview(
          openspecPreviewCwd,
          decodeURIComponent(openspecPreviewParams.changeName),
          decodeURIComponent(openspecPreviewParams.artifactId),
        )}
      </>
    );
  if (fileViewMatch && fileViewCwd && fileViewPath && free)
    return <>{render.renderFilePreview(fileViewCwd, fileViewPath)}</>;
  if (urlViewMatch && urlViewUrl && free) return <>{render.renderUrlPreview(urlViewUrl)}</>;
  // Desktop renders the folder editor from its own block above this region.
  if (variant === "mobile" && folderEditorCwd) return <>{render.renderFolderEditor(folderEditorCwd)}</>;
  if (folderHomeCwd && free) return <>{render.renderFolderHome(folderHomeCwd)}</>;

  const session = selectedId ? render.renderSession(selectedId) : null;
  return <>{session ?? render.renderLanding()}</>;
}
