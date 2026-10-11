## MODIFIED Requirements

### Requirement: Watch-and-rebuild server
`deck3d serve <deck.md> [--port <n>] [--check]` SHALL start an HTTP server bound to loopback only (`127.0.0.1`), serve the built deck at `/`, and watch `deck.md`, the deck's `fx/` directory, its `deck.json`, a `style.json` beside it, and every file listed in `overrides.assets` for changes. While `style.json` has `pending: true` (a variant pick in progress), rebuilds SHALL be deferred, then run once it clears. On a change it SHALL rebuild the deck and notify connected browsers. Rebuilds SHALL be debounced so a burst of writes (an editor's save-all, a formatter) produces one rebuild. A rebuild that fails SHALL leave the last good deck being served and report the error to the browser rather than terminating the server.

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

#### Scenario: Asset change rebuilds
- **WHEN** a file listed in `overrides.assets` is rewritten while `serve` runs
- **THEN** one rebuild runs and connected browsers reload

#### Scenario: Pick in progress defers rebuild
- **WHEN** `style.json` is written with `pending: true`, then `deck.json` changes, then `style.json` is written with `pending: false`
- **THEN** no rebuild runs while `pending` is true, and exactly one runs after it clears
