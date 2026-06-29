import type { CodeNodeContext } from "@blackbelt-technology/pi-flows";

// Code-step coverage: consumes upstream agent outputs as handler inputs,
// exercises value coercion (number -> String), and the setSummary contract.
interface Input {
  token: string;
  count: string;
}

interface Output {
  doubled: string;
  verified: string;
}

export default async function (input: Input, ctx: CodeNodeContext): Promise<Output> {
  const ok = input.token === "EMIT_OK" && input.count === "42";
  ctx.logger(`transform received token="${input.token}" count="${input.count}"`);
  ctx.setSummary(ok ? "transform-ok" : `transform-mismatch token=${input.token} count=${input.count}`);
  return {
    doubled: String(Number(input.count) * 2),
    verified: ok ? "yes" : "no",
  };
}
