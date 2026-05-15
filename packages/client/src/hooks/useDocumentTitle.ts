import { useEffect } from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { buildDocumentTitle } from "../lib/document-title.js";

const DEFAULT_TITLE = "PI Dashboard";

export function useDocumentTitle(session: DashboardSession | undefined): void {
  useEffect(() => {
    document.title = buildDocumentTitle(session);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [session]);
}
