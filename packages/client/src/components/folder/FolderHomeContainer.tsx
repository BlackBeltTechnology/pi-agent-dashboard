/**
 * Data-fetching shell for the folder home: owns the per-cwd hooks the
 * presentational `DirectoryHomeView` must not call itself (folder command list,
 * model catalogue), so any cwd — including a frozen overlay underlay — gets its
 * own data without App having to hold hooks per folder.
 *
 * See change: redesign-directory-home-split.
 */
import { useFolderCommands } from "../../hooks/useFolderCommands.js";
import { useModelCatalogue } from "../../hooks/useModelCatalogue.js";
import { DirectoryHomeView, type DirectoryHomeViewProps } from "./DirectoryHomeView.js";

export type FolderHomeContainerProps = Omit<DirectoryHomeViewProps, "commands" | "commandsOrigin" | "models">;

export function FolderHomeContainer(props: FolderHomeContainerProps) {
  const folder = useFolderCommands(props.cwd);
  const catalogue = useModelCatalogue({ seedFromCache: true });
  return (
    <DirectoryHomeView
      {...props}
      commands={folder.commands}
      commandsOrigin={folder.origin}
      models={catalogue.models}
    />
  );
}
