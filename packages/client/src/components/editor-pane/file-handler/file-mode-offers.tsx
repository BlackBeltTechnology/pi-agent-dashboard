/**
 * The file-handler modes the active tab can switch to, exposed to the built-in viewer so a dead-end notice
 * (the binary-file notice) can name them (D11 A4). EditorPane provides it from the same matching claims the
 * mode switcher shows; `null` outside a session pane, for a file outside the session folder, or with no
 * matching enabled claim. See change: extend-craft-web-to-all-apps.
 */
import { createContext, useContext } from "react";
import type { FileHandlerClaim } from "./file-handler-claims.js";

export interface FileModeOffers {
  /** Matching enabled claims, switcher order. */
  claims: readonly FileHandlerClaim[];
  /** Same action as the switcher button of `key`. */
  onSelect: (key: string) => void;
}

export const FileModeOffersContext = createContext<FileModeOffers | null>(null);

export const useFileModeOffers = (): FileModeOffers | null => useContext(FileModeOffersContext);
