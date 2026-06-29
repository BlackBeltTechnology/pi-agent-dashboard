import type { CodeNodeContext } from "@blackbelt-technology/pi-flows";

type Branch = "again" | "go";

interface Input {
  worker_summary: string;
  iteration: string;
  max: string;
}

export default async function (input: Input, _ctx: CodeNodeContext): Promise<{ branch: Branch }> {
  // Loop back while the worker reports not-done and iterations remain.
  const done = input.worker_summary === "done";
  const last = Number(input.iteration) >= Number(input.max);
  return { branch: done || last ? "go" : "again" };
}
