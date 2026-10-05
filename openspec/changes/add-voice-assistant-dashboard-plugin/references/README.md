# References — set-copilot field material (Tatár Gábor, ITLine)

Received by mail at robson@semmi.se on 2026-10-03. Kept verbatim and read-only. They are design input, not specification.

| File | Mail subject | What it is |
|---|---|---|
| `2026-10-03-set-copilot-playbook.md` | "set-copilot playbook — how we ran it on a client call" (22:08 UTC) | Anonymised field report from a 60-minute client call: config, instructions file, knowledge layout, before/during/after, 14 lessons, next steps |
| `2026-10-03-set-copilot-architecture.html` | "set-copilot — architecture overview" (23:01 UTC) | Signal-path architecture with 15 SVG figures (capture, Soniox streaming/reconnect, sentence building, fast lane, poll, model turn, forks, digest, redaction + wall, mirror, dictation, stitch). Self-contained HTML; open it in a browser, works offline. Figures reflect upstream code as of 2026-10-04 |

## How these are used

- **Upstream behaviour** (what set-copilot does and why) is taken from these documents and from the vendored source at the pinned SHA.
- **Our system replaces their Claude-Code-specific parts.** Voice handling and agent control are pi-dashboard's own, so the following set-copilot mechanisms are **not** adopted:
  - the Claude Code skills (`/ds`, `/dd`, `/meeting-copilot`, `/transcript-recover`, `/set-repair`);
  - the Monitor loop;
  - `subagent_type: "fork"` producers;
  - `mirror-follow` tailing of the Claude Code transcript;
  - Stop hooks;
  - the `.set/copilot/<session-id>/` location in the project.

  Each has a counterpart in our design: see `design.md` § "Own-system mapping".
- "Copilot" always means set-copilot's meeting-copilot **role**, played by a pi session. No Anthropic or Claude Code tooling is used.
