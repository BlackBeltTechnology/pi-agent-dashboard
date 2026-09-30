/**
 * Contract between the flows-plugin bridge and server for reporting a session's
 * flow files (see `bridge/flow-files-reporter.ts`, `server/flow-files.ts`).
 * Import-free leaf so the bridge never pulls server code.
 * See change: attach-flow-before-run.
 */

export interface ReportedFile {
  name: string;
  source: string;
}

export interface FlowFilesReport {
  flows?: ReportedFile[];
  agents?: ReportedFile[];
}

/** Private bridge → server lane message carrying a {@link FlowFilesReport}. */
export const FLOW_FILES_REPORT = "flow-files/report";
/** pi event the server emits into a session to ask its bridge to (re)report. */
export const FLOW_FILES_REQUEST_EVENT = "dashboard-flows:report-files";
