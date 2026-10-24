# blender-mcp-server Specification

## Purpose
A stdio MCP server that gives an agent one persistent, sandboxed, headless Blender scene, with tools to run Python, inspect the scene and move files in and out. File access is confined to a project root, and the session lifecycle survives crashes, timeouts and idleness.

## Requirements

### Requirement: MCP protocol subset over stdio
The server SHALL speak newline-delimited JSON-RPC 2.0 on stdin/stdout and SHALL handle `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` and `notifications/cancelled`. Any other method SHALL get error `-32601`, and unparseable input SHALL get `-32700`. The server SHALL write nothing but protocol messages to stdout.

#### Scenario: Initialize then list tools
- **WHEN** a client sends `initialize` followed by `tools/list`
- **THEN** the server answers `initialize` with a `tools` capability and lists exactly `blender_python`, `blender_scene`, `blender_import`, `blender_export` and `blender_reset`, each with an input schema

#### Scenario: Unknown method
- **WHEN** a client sends `resources/list`
- **THEN** the server answers with JSON-RPC error `-32601`

### Requirement: Protocol version negotiation
`initialize` SHALL answer with the client's requested protocol version when the server supports it, and otherwise with the latest version the server supports.

#### Scenario: Unsupported requested version
- **WHEN** a client sends `initialize` with protocol version `1999-01-01`
- **THEN** the response carries the server's latest supported protocol version

### Requirement: Tool failures are tool results
A failing tool call SHALL return a result with `isError: true` carrying a lowercase machine `code` and a message, not a JSON-RPC error. The codes SHALL be: `invalid-arguments`, `jspi-unavailable`, `provision-failed`, `boot-failed`, `path-outside-root`, `input-not-found`, `unsupported-format`, `limit-exceeded`, `python-error`, `import-failed`, `export-failed`, `timeout` and `session-crashed`.

#### Scenario: Python raises
- **WHEN** `blender_python` runs code that raises an exception
- **THEN** the result has `isError: true`, code `python-error`, and the Python traceback

#### Scenario: Argument out of range
- **WHEN** `blender_python` is called with `timeoutSec: 601`
- **THEN** the result has `isError: true` and code `invalid-arguments`

#### Scenario: Unknown tool
- **WHEN** a client calls `tools/call` with tool name `blender_render`
- **THEN** the result has `isError: true` and code `invalid-arguments`

#### Scenario: Corrupt import data
- **WHEN** `blender_import` is given a `.glb` file whose content is not valid glTF
- **THEN** the result has `isError: true` and code `import-failed`

### Requirement: Result encoding and envelope
Every tool result's first content block SHALL be JSON text holding `sessionReset` and `durationMs` plus the tool's fields, or `code` and `message` on failure. Printed output, when present, SHALL be the last content block, holding at most its final 16 KiB, with truncation flagged in the first block. `durationMs` SHALL run from the call leaving the queue to its result.

#### Scenario: Chatty script
- **WHEN** `blender_python` runs code that prints 1 MiB of text ending with the line `DONE`
- **THEN** the last content block holds at most 16 KiB ending with `DONE`, and the first block flags the output as truncated

### Requirement: Session reset signal
`sessionReset` SHALL be true on the first result, successful or failed, produced after a live session was lost to a timeout, crash, cancellation, idle shutdown or repair. It SHALL be false on every other result, including the first boot.

#### Scenario: First boot
- **WHEN** the first tool call of a server process boots a session
- **THEN** its result has `sessionReset: false`

#### Scenario: Failed first call after a loss
- **WHEN** a session was lost to a timeout and the next call fails with `python-error`
- **THEN** that failed result carries `sessionReset: true`, and the call after it carries `sessionReset: false`

### Requirement: No network listener
The server and its Blender host SHALL NOT open any listening or datagram socket, and the Blender runtime SHALL load only from the local runtime directory.

#### Scenario: Running server opens no socket
- **WHEN** a session has booted and served a call
- **THEN** no listening TCP socket and no UDP socket was created by the server process or its host child

### Requirement: Agent code has no outbound network
Agent-supplied Python SHALL NOT be able to open any outbound connection from the server process or its host child.

#### Scenario: Python connects to a local listener
- **WHEN** a test listener is open on a local port and `blender_python` runs code that connects to that port and prints the exception it gets
- **THEN** the listener receives no connection and the output shows a connection error

### Requirement: Persistent scene across calls
Within one live session, scene changes made by one tool call SHALL be visible to the next.

#### Scenario: Object survives between calls
- **WHEN** `blender_python` adds an object named `Probe` and a later `blender_scene` call runs in the same session
- **THEN** the scene listing contains `Probe`

### Requirement: Run Python with staged inputs and collected outputs
`blender_python` SHALL run the given code in the session, staging each listed input at `/in/<root-relative path>` so relative layout is kept. Every file the code writes under `/out/` SHALL be written below `outputDir` (default `blender-out`) inside the root, keeping its layout, and listed in the result. Staged inputs SHALL NOT remain visible to later calls.

#### Scenario: Export via Python lands in the workspace
- **WHEN** `blender_python` runs code that exports `/out/model.glb`, with no `outputDir`
- **THEN** `blender-out/model.glb` exists under the root, is a valid GLB, and is listed in the result

#### Scenario: Same basename in two folders
- **WHEN** `blender_python` is called with `inputs: ["a/part.obj", "b/part.obj"]` and code that imports `/in/a/part.obj` and `/in/b/part.obj`
- **THEN** both imports succeed with their own contents

#### Scenario: Multi-file asset keeps its references
- **WHEN** `blender_python` is called with `inputs` naming `assets/chair.obj` and its `assets/chair.mtl`, and code that imports `/in/assets/chair.obj`
- **THEN** the imported object carries the material defined in `chair.mtl`

#### Scenario: Missing input
- **WHEN** `blender_python` is called with an input path that does not exist under the root
- **THEN** the call fails with code `input-not-found` and no code runs

#### Scenario: Inputs do not leak into the next call
- **WHEN** one `blender_python` call stages `assets/a.obj` and a later call without inputs checks whether `/in/assets/a.obj` exists
- **THEN** the file does not exist

#### Scenario: Agent file named like a protocol file
- **WHEN** `blender_python` code writes `/out/report.json`
- **THEN** `blender-out/report.json` in the workspace holds the agent's content

### Requirement: Protocol markers cannot forge results
Agent code that prints text imitating the session's internal completion or status markers SHALL NOT produce a successful or `limit-exceeded` result it did not earn. The call SHALL either complete normally or fail with `session-crashed`.

#### Scenario: Agent prints a completion marker
- **WHEN** `blender_python` code prints `<<<BW_DONE 1>>>` through `<<<BW_DONE 50>>>` and then writes `/out/a.txt`
- **THEN** the call either succeeds with `blender-out/a.txt` written, or fails with `session-crashed` and writes nothing

### Requirement: Scene inspection
`blender_scene` SHALL return the Blender version, the runtime version, the total object count and, for up to `limit` objects (default 200, at most 1000): name, type, parent, location, rotation, scale, dimensions, material names, and vertex and face counts for meshes. It SHALL flag when objects were left out.

#### Scenario: Factory scene listing
- **WHEN** `blender_scene` is called on a freshly booted factory session
- **THEN** it lists `Camera`, `Cube` and `Light` with their types and a total of 3

#### Scenario: Large scene
- **WHEN** the scene holds 500 objects and `blender_scene` is called without `limit`
- **THEN** it lists 200 objects, reports a total of 500, and flags the listing as truncated

### Requirement: Import by file extension
`blender_import` SHALL import exactly one regular file, chosen case-insensitively by extension: `.glb`, `.gltf`, `.fbx`, `.obj`, `.stl`, `.ply`, `.svg` or `.blend`. A `.blend` replaces the scene. A `.gltf` referencing any non-`data:` buffer or image URI, and any other extension, SHALL fail with `unsupported-format`. A path that is not a regular file SHALL fail with `invalid-arguments`.

#### Scenario: glTF with an external buffer
- **WHEN** `blender_import` is given a `.gltf` file that references an external `.bin` buffer
- **THEN** the call fails with code `unsupported-format` naming the external reference

#### Scenario: Blend replaces the scene
- **WHEN** a `.blend` saved from a scene containing only `Probe` is imported into a factory session
- **THEN** a following `blender_scene` lists only `Probe`

#### Scenario: Directory given
- **WHEN** `blender_import` is called with a path naming a directory
- **THEN** the call fails with code `invalid-arguments`

### Requirement: Export by file extension with sidecars
`blender_export` SHALL write `.glb`, `.gltf` (with its `.bin` buffer as a sidecar), `.fbx`, `.obj`, `.stl`, `.ply` or `.blend`, chosen case-insensitively by extension. Every additional file the exporter produces SHALL be written next to the target and listed. Any other extension SHALL fail with `unsupported-format`, and `selectedOnly` with `.blend` SHALL fail with `invalid-arguments`.

#### Scenario: OBJ with material library
- **WHEN** `blender_export` writes `out/scene.obj` from a scene with a material
- **THEN** both `out/scene.obj` and `out/scene.mtl` exist and are listed in the result

#### Scenario: Round-trip through FBX
- **WHEN** `blender_export` writes `out/scene.fbx` and `blender_import` then reads it back
- **THEN** both calls succeed and the import result names the imported objects

#### Scenario: USD is refused
- **WHEN** `blender_export` is called with path `out/scene.usdc`
- **THEN** the call fails with code `unsupported-format`

### Requirement: Reset
`blender_reset` SHALL replace the session scene with the factory startup scene (default) or an empty scene (`mode: "empty"`).

#### Scenario: Empty reset
- **WHEN** `blender_reset` is called with `mode: "empty"` and then `blender_scene` is called
- **THEN** the scene lists no objects

### Requirement: Path confinement to the root
Every path argument SHALL be relative and SHALL resolve, after following symlinks, inside the root: the server cwd, or `--root`. For an output that does not exist yet, its nearest existing ancestor SHALL resolve inside the root. Any other path SHALL fail with `path-outside-root`.

#### Scenario: Absolute path refused
- **WHEN** `blender_import` is called with `/etc/hosts`
- **THEN** the call fails with code `path-outside-root`

#### Scenario: Symlink escape refused
- **WHEN** the root contains `link -> /tmp` and `blender_export` targets `link/out.glb`
- **THEN** the call fails with code `path-outside-root` and nothing is written under `/tmp`

### Requirement: All-or-nothing output writes
A call SHALL write its workspace outputs only after every output path is confined and every limit is met. When any output fails confinement, a limit or a write, the workspace SHALL be left as it was before the call, including files the call would have replaced.

#### Scenario: One escaping key among several outputs
- **WHEN** Python code writes `/out/good.glb` and also a file whose returned relative key normalises outside `outputDir`
- **THEN** the call fails with code `path-outside-root` and `blender-out/good.glb` does not exist

#### Scenario: Write failure restores replaced files
- **WHEN** a call would replace an existing `blender-out/a.glb` and writing its second output fails
- **THEN** the call fails, and `blender-out/a.glb` holds its previous content

### Requirement: Size limits
A call SHALL fail with `limit-exceeded`, and write nothing, when its inputs exceed 64 files or 256 MiB total, its code exceeds 1 MiB, or its outputs exceed 512 MiB total. Output size SHALL be enforced before output bytes leave the Blender host process, independently of agent code. `BLENDER_WASM_MAX_INPUT_MB` and `BLENDER_WASM_MAX_OUTPUT_MB` SHALL be able to lower, never raise, the byte limits. More than 32 queued calls SHALL fail with `limit-exceeded`.

#### Scenario: Oversized outputs
- **WHEN** `BLENDER_WASM_MAX_OUTPUT_MB=1` and Python code writes 2 MiB under `/out/`
- **THEN** the call fails with code `limit-exceeded`, the session stays live, and no output file is written to the workspace

#### Scenario: Agent tampers with size accounting
- **WHEN** `BLENDER_WASM_MAX_OUTPUT_MB=1` and Python code replaces `os.path.getsize` with a function returning 0, then writes 2 MiB under `/out/`
- **THEN** the call fails with code `limit-exceeded` and no output file is written

#### Scenario: Limit cannot be raised
- **WHEN** `BLENDER_WASM_MAX_OUTPUT_MB=4096`
- **THEN** the effective output limit is still 512 MiB

### Requirement: Agent code cannot reach the host
Agent-supplied Python SHALL run with only an in-memory filesystem, with no access to host files, host processes or the host JavaScript environment. Host files SHALL reach it only through staged inputs, and it SHALL reach host files only through collected outputs.

#### Scenario: Host file not readable from Python
- **WHEN** a uniquely named temporary file is created on the host outside the root and `blender_python` runs code that tries to read that absolute path
- **THEN** the code cannot obtain the file's content

#### Scenario: No subprocess
- **WHEN** `blender_python` runs code that calls `subprocess.run(["ls"])`
- **THEN** Python raises `OSError` and no host process is started

### Requirement: Serial calls and cancellation
The server SHALL run tool calls one at a time, in arrival order. `notifications/cancelled` SHALL remove a queued call without a response. For the in-flight call it SHALL end the session without a response, and the next result SHALL report `sessionReset: true`.

#### Scenario: Second call waits
- **WHEN** two `blender_python` calls arrive back to back
- **THEN** the second starts only after the first has returned its result

#### Scenario: Queued call cancelled
- **WHEN** a call is queued behind a running call and the client cancels the queued one
- **THEN** the queued call is never run and no response is sent for it

#### Scenario: In-flight call cancelled
- **WHEN** the client cancels a running `blender_python` call
- **THEN** no response is sent for it, the host process no longer exists 5 seconds after the cancellation, and the next call succeeds with `sessionReset: true`

### Requirement: Timeout ends the session
Every tool SHALL accept an optional `timeoutSec` (1–600, default 120). A call exceeding it SHALL fail with `timeout`, the session SHALL be ended, and the next call SHALL boot a fresh session and report `sessionReset: true`. The timeout SHALL cover only the operation, not runtime provisioning or session boot.

#### Scenario: Infinite loop
- **WHEN** `blender_python` runs `while True: pass` with `timeoutSec: 5`
- **THEN** the call fails with code `timeout` within 10 seconds of starting, the host process no longer exists 5 seconds after that result, and the next call succeeds with `sessionReset: true`

#### Scenario: First call includes a download
- **WHEN** the first call of a server process with an empty cache uses `timeoutSec: 5` and provisioning takes longer than 5 seconds
- **THEN** the call does not fail with `timeout` because of provisioning time

### Requirement: Boot failure and cache repair
When a Blender session does not reach ready within 120 seconds, or its host exits during boot, the call SHALL fail with `boot-failed` carrying the last diagnostic lines. When the session booted from a downloaded cache, the server SHALL then re-verify every cached runtime file and discard the cache on any mismatch, so the next call provisions afresh.

#### Scenario: Corrupted cached wasm heals
- **WHEN** the cached runtime wasm has the stamped size but corrupted content and a tool call boots a session
- **THEN** the call fails with code `boot-failed`, the server still answers `ping`, and the next call provisions the runtime again and succeeds

#### Scenario: Corrupted cached glue heals
- **WHEN** the cached runtime glue script has the stamped size but corrupted content and a tool call boots a session
- **THEN** the call fails with code `boot-failed`, and the next call provisions the runtime again and succeeds

### Requirement: Crash recovery
If the Blender session dies during a call, that call SHALL fail with `session-crashed` and the last diagnostic lines. The server SHALL keep running, and the next call SHALL boot a fresh session and report `sessionReset: true`.

#### Scenario: Interpreter abort
- **WHEN** `blender_python` runs code that calls `os.abort()`
- **THEN** the call fails with code `session-crashed`, the server still answers `ping`, and the next call reports `sessionReset: true`

### Requirement: Idle shutdown returns memory
After `BLENDER_WASM_IDLE_SEC` seconds (default 600) without a call queued or running, the server SHALL end the session and release its memory. The next call SHALL boot a fresh session and report `sessionReset: true`.

#### Scenario: Idle then call
- **WHEN** `BLENDER_WASM_IDLE_SEC=2`, a call completes, and the server stays idle for 3 seconds
- **THEN** the previous Blender host process no longer exists, and the next call reports `sessionReset: true`

#### Scenario: Long call is not idle
- **WHEN** `BLENDER_WASM_IDLE_SEC=2` and a `blender_python` call runs for 4 seconds
- **THEN** the call completes normally and its result has `sessionReset: false`

### Requirement: Lazy start
The server SHALL NOT probe JSPI, provision or boot Blender before the first Blender tool call. `initialize`, `ping` and `tools/list` SHALL succeed without a runtime present.

#### Scenario: Listing tools offline with empty cache
- **WHEN** the cache is empty, the network is unavailable, and a client sends `initialize` and `tools/list`
- **THEN** both succeed and nothing is downloaded

### Requirement: JSPI runtime gate before provisioning
On the first Blender tool call the server SHALL check, before any download, that the host Node exposes WebAssembly JSPI, natively or behind `--experimental-wasm-jspi`. When it is unavailable, every Blender tool call SHALL fail with `jspi-unavailable`, naming the detected Node version and the requirement "Node 24 or newer". No runtime SHALL be provisioned.

#### Scenario: Node 22 host
- **WHEN** the server runs on Node 22.22 with an empty cache and `blender_scene` is called
- **THEN** the call fails with code `jspi-unavailable` naming Node 22.22 and "Node 24 or newer", and no download occurs

#### Scenario: Node 24 host
- **WHEN** the server runs on Node 24 without any flag, with a valid cached runtime, and `blender_scene` is called
- **THEN** the call succeeds

### Requirement: Shutdown leaves no Blender process
When stdin closes, or the server receives SIGINT or SIGTERM, it SHALL end the Blender session before exiting. When the process that pi started dies without cleanup, every process it started for the server, including the Blender host, SHALL exit on its own.

#### Scenario: Client disconnects
- **WHEN** a session is live and the client closes the server's stdin
- **THEN** the server exits and the Blender host process no longer exists

#### Scenario: Killed during an infinite loop
- **WHEN** `blender_python` is running `while True: pass` and the process pi started receives SIGKILL
- **THEN** no server or Blender host process of it remains after 5 seconds

### Requirement: Performance budget
On the project's CI runners, with a valid cached runtime, a session SHALL reach ready within 15 seconds of the first tool call. `blender_scene` on the factory scene of a live session SHALL return within 2 seconds. The Blender host process's resident memory SHALL stay at or below 2.5 GB after booting and serving one factory-scene GLB export.

#### Scenario: Warm boot
- **WHEN** the cache holds a valid runtime and the first `blender_scene` call of a server process is made
- **THEN** its result arrives within 15 seconds

#### Scenario: Scene call on a live session
- **WHEN** a session is live with the factory scene and `blender_scene` is called
- **THEN** its result arrives within 2 seconds

#### Scenario: Host memory after an export
- **WHEN** a fresh session has booted and `blender_export` has written a GLB of the factory scene
- **THEN** the host process's resident memory is at or below 2.5 GB

### Requirement: Root must exist
The server SHALL refuse to start, printing an error to stderr and exiting `1`, when `--root` names a path that does not exist or is not a directory.

#### Scenario: Missing root
- **WHEN** `pi-blender mcp --root does-not-exist` starts
- **THEN** it prints an error to stderr, writes nothing to stdout, and exits `1`
