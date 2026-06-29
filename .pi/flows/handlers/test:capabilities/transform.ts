import type { CodeNodeContext } from "@blackbelt-technology/pi-flows";

interface Input {
  token: string;
  count: string;
}

interface Output {
  status: string;
  summary: string;
  doubled: string;
  verified: string;
}

export default async function (input: Input, _ctx: CodeNodeContext): Promise<Output> {
  // Verify upstream agent outputs arrived as handler inputs.
  const ok = input.token === "EMIT_OK" && input.count === "42";
  return {
    status: "success",
    summary: ok ? "transform-ok" : "transform-mismatch",
    doubled: String(Number(input.count) * 2),
    verified: ok ? "yes" : "no",
  };
}
