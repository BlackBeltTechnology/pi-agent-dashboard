/**
 * Client-side fetch helper for the `/api/doctor` route.
 *
 * See change: doctor-rich-output (task 5.1).
 */
import type { DoctorReport } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";
import { getApiBase } from "./api-context.js";

export type { DoctorReport, DoctorCheck } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

export class DoctorFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly bodyExcerpt: string,
  ) {
    super(message);
    this.name = "DoctorFetchError";
  }
}

export async function fetchDoctorReport(): Promise<DoctorReport> {
  const res = await fetch(`${getApiBase()}/api/doctor`, { credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DoctorFetchError(
      `GET /api/doctor returned ${res.status}`,
      res.status,
      body.slice(0, 500),
    );
  }
  const json = (await res.json()) as DoctorReport;
  if (!json || !Array.isArray(json.checks) || !json.summary) {
    throw new DoctorFetchError(
      "GET /api/doctor returned an invalid shape",
      res.status,
      JSON.stringify(json).slice(0, 500),
    );
  }
  return json;
}
