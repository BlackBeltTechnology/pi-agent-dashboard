/**
 * Mirrors the resolved card-effect switches onto `<html>` as
 * `data-fx-status` / `data-fx-glow` ("on" | "off"); `index.css` gates the
 * animated layers on them (one mechanism for sidebar cards and board rows).
 * See change: add-focus-mode-and-card-block-toggles (design D5).
 */
import { type CardSectionPrefs, resolveCardSectionVisible } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { useEffect } from "react";

export function useCardFxAttributes(prefs: CardSectionPrefs): void {
  const status = resolveCardSectionVisible(prefs, undefined, "fx-status-animation");
  const glow = resolveCardSectionVisible(prefs, undefined, "fx-selected-glow");
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-fx-status", status ? "on" : "off");
    root.setAttribute("data-fx-glow", glow ? "on" : "off");
  }, [status, glow]);
}
