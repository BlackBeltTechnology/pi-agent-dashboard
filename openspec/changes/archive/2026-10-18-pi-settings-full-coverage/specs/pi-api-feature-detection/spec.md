## MODIFIED Requirements

### Requirement: pi 0.87–1.0 TUI-only and non-consumed changes SHALL be recorded as documented no-ops

The adoption record SHALL list, as having no dedicated dashboard surface: the `system` theme and OKHSL/`#rgb` theme colors, `fullscreenWheelScrollLines`, the startup header change, ChatGPT sign-in on the OpenAI provider, the GPT-6.1 Sol Codex default, HTML-export hidden-message toggles, pi's TypeScript 7 build and removal of `tsx`, `provider_stream_event`, llama.cpp and Jev classifier models, per-model image input limits, and the `builtin:<name>` naming of built-in extensions in RPC source info (no dashboard code parses `<inline:` / `<builtin:` names); and from 0.99.2–1.0.0: the fullscreen-by-default TUI (dashboard tmux sessions keep pi's default, no `tuiMode` override), `quietStartup: "header"`, leaner codemode descriptions and errors, Radius in `/login` (`radius` stays excluded from the registry), MCP OAuth hardening, `/reload` enabling newly added `defaultTools`, and `--provider` without `--model` failing (the dashboard never passes `--provider`). The generic pi settings page MAY expose `quietStartup` and `theme` (including the `system` theme) as ordinary rows of the user's global pi settings; that is not a dedicated surface. `tuiMode` and `fullscreenWheelScrollLines` stay JSON-only on that page. The dashboard SHALL still never set or override any of these values for the sessions it starts.

#### Scenario: No-op list is present
- **WHEN** the change is archived
- **THEN** the feature-detection spec SHALL name each listed item as a no-op with the reason

#### Scenario: Settings rows are not an override
- **GIVEN** the user has not set `tuiMode` in the pi settings page
- **WHEN** the dashboard starts a pi session in tmux
- **THEN** no `tuiMode` value SHALL be passed or written by the dashboard
