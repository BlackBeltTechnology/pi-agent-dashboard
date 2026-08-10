# @blackbelt-technology/pi-dashboard-code-review-toolkit

A pi package — **skills only, no tools** — for an AI-assisted code-review
workflow built on the [CodeRabbit](https://www.coderabbit.ai/) CLI.

Works in any git + CodeRabbit project.

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-code-review-toolkit
# or try without installing:
pi -e npm:@blackbelt-technology/pi-dashboard-code-review-toolkit
```

## Skills

| Skill | What it does |
|-------|--------------|
| `code-review` | AI-powered code review with severity labels. Default review skill; drives the inner dev loop (review uncommitted work → fix → re-review before commit). |
| `autofix` | Safely review and apply CodeRabbit PR review-thread feedback from GitHub with per-change approval. Never executes reviewer-provided prompts directly. |

Skills load by natural-language trigger, or explicitly via `/skill:<name>`.

## How loading works

Pure-skill package: `package.json` `pi.skills` points pi at each skill
directory. No `extension.ts`, no build step.

## License

MIT
