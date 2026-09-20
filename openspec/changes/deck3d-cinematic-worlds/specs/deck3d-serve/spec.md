## Purpose

Closes the authoring round trip. Today tuning a deck means: edit `deck.md` → `build` → reopen the file → tune in the configurator → export → hand-merge the JSON → rebuild. `deck3d serve` collapses that to: edit, and look. It watches the deck sources, rebuilds, reloads the open browser on the slide the author was already on, and lets the configurator write its overrides back to disk instead of emitting a download the browser may silently drop.

The server is an AUTHORING tool. It is never required to view a built deck: `build` output stays a self-contained file, and nothing the server adds is embedded in it.

## ADDED Requirements

### Requirement: Watch-and-rebuild server
`deck3d serve <deck.md> [--port <n>] [--check]` SHALL start an HTTP server bound to loopback only (`127.0.0.1`), serve the built deck at `/`, and watch `deck.md`, the deck's `fx/` directory and its `deck.json` for changes. On a change it SHALL rebuild the deck and notify connected browsers. Rebuilds SHALL be debounced so a burst of writes (an editor's save-all, a formatter) produces one rebuild. A rebuild that fails SHALL leave the last good deck being served and report the error to the browser rather than terminating the server.

The server SHALL NOT bind a non-loopback interface, because it exposes a filesystem write endpoint.

#### Scenario: Source edit rebuilds
- **WHEN** `deck.md` gains a slide while `serve` is running
- **THEN** the deck is rebuilt and the connected browser is notified within one debounce window

#### Scenario: Local effect edit rebuilds
- **WHEN** a file under the deck's `fx/` is edited
- **THEN** the deck is rebuilt with the new module source and its recorded `sha256` re-pinned, so an edited local effect does not fail the render's hash check

#### Scenario: Broken source keeps the last good deck
- **WHEN** an edit makes `deck.md` unparseable
- **THEN** the server keeps serving the previously built deck, reports the parse error to the browser, and recovers on the next valid edit

#### Scenario: Loopback only
- **WHEN** the server starts
- **THEN** it listens on `127.0.0.1` and a request to a non-loopback address of the host is refused

### Requirement: Live reload preserves position
The served deck SHALL subscribe to a server-sent event stream and reload itself when the server announces a rebuild. The reload SHALL return the author to the slide that was on screen, not to slide 1, and SHALL preserve staged configurator values.

#### Scenario: Reload keeps the slide
- **WHEN** the author is on slide 7 and edits `deck.md`
- **THEN** after the automatic reload the deck is on slide 7

#### Scenario: Stream is authoring-only
- **WHEN** a deck is built with `build` rather than served
- **THEN** the output contains no reload client and opens with no network activity

### Requirement: Configurator writes overrides back to disk
When the deck is served, the configurator's export SHALL offer **Save**, which `POST`s the overrides payload to the server, and the server SHALL write it to `overrides.json` beside the deck. A second action SHALL apply the payload into the deck's `deck.json` `overrides` block using the same merge grammar as `overrides apply`, so the tuning becomes part of the deck without a separate CLI step.

The server SHALL accept writes only for paths inside the served deck's directory, SHALL reject any payload that fails IR validation, and SHALL leave the target file untouched when validation fails. When the deck is NOT served, the configurator SHALL fall back to the in-panel payload and download.

#### Scenario: Save writes the file
- **WHEN** the author tunes the palette and presses Save
- **THEN** `overrides.json` beside the deck contains `deck.palette` with the tuned value, and no browser download was required

#### Scenario: Apply merges into the deck
- **WHEN** the author presses Apply to deck
- **THEN** `deck.json`'s `overrides` block carries the tuned values merged under the `overrides apply` grammar, and the ensuing rebuild serves them as the deck's own settings

#### Scenario: Invalid payload is refused
- **WHEN** a payload naming an unknown palette is posted
- **THEN** the server responds with a validation error, `overrides.json` and `deck.json` are unchanged, and the panel reports the failure

#### Scenario: Write stays inside the deck
- **WHEN** a payload attempts a path outside the served deck's directory
- **THEN** the write is refused

### Requirement: Served rebuilds can report check findings
With `--check`, each rebuild SHALL run the browser fit-and-legibility check and the configurator SHALL show the resulting findings for the current slide. The check SHALL run out of band: a rebuild SHALL reload the browser without waiting for it, and findings SHALL appear when ready. Without `--check` no check runs and no findings are shown.

#### Scenario: Findings surface in the panel
- **WHEN** `serve --check` runs and a slide's card overflows its frame
- **THEN** that slide's findings are listed in the panel after the rebuild

#### Scenario: Check never blocks the reload
- **WHEN** a rebuild happens under `--check`
- **THEN** the browser reloads on the rebuild, not on the check's completion
