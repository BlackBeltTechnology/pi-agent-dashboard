# @blackbelt-technology/pi-system-one

Typed System-1 decisions (`choice` / `score` / `noul`) for pi extensions and the
pi-dashboard server, through one user-controlled registry of backends:

- hosted TypeSafe Jev and any `/v1/systemone` endpoint (`http`),
- dashboard-managed local Von / Laya servers (`managed`, loopback only),
- a pi chat-model role such as `@fast` as a slow fallback (`llm`).

Node built-ins only. No runtime dependencies.

## Use

```ts
import { predict } from "@blackbelt-technology/pi-system-one";

const r = await predict({
  consumer: { id: "my-ext:is_destructive", failurePolicy: "fail-open" },
  state: JSON.stringify({ command: "rm -rf build/" }),
  questions: { destructive: { type: "noul", instructions: "Does this command delete user data?" } },
});

if (!r.ok) {
  // r.reason: no-backend | capability | off-machine | timeout | error
  // apply your declared policy (r.policy)
} else if (r.mode === "enforce" && (r.answers.destructive as { noul: number }).noul >= (r.thresholds.destructive ?? 1)) {
  // act only on calibrated, enforced answers
}
```

The adapter never allows or blocks anything itself: it reports `mode`,
`thresholds` and `policy`, and the consumer decides. Answers are advisory
(`shadow`) until the user measures a backend for your consumer with the
dashboard's Test and saves it as `enforce`.

## Configuration

`~/.pi/agent/system-one.json`, edited from the dashboard settings section
"Decision models (System 1)". Nothing leaves the machine unless
`allowOffMachine` is `true`. Keys come from an env var (e.g.
`TYPESAFE_API_KEY`) or `~/.pi/agent/system-one/auth.json` (0600), never from the
config file.

Full reference: [`docs/system-one.md`](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/develop/docs/system-one.md).

## License

MIT
