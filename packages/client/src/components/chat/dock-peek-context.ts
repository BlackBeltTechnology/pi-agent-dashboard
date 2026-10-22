/**
 * Lets a lane body end a hover peek of the collapsed dock (activating a row
 * target or Review returns the dock to collapsed). The default is a no-op, so
 * lanes rendered outside a `ComposerDock` (and an expanded dock) are unaffected.
 *
 * See change: composer-dock-collapse-and-file-open (D3).
 */
import { createContext, useContext } from "react";

export interface DockPeekApi {
  /** Return a peeked dock to collapsed; no-op when not peeking. */
  endPeek: () => void;
}

const NOOP: DockPeekApi = { endPeek: () => {} };

export const DockPeekContext = createContext<DockPeekApi>(NOOP);

export function useDockPeek(): DockPeekApi {
  return useContext(DockPeekContext);
}
