## ADDED Requirements

### Requirement: Opt-in backend selection

`generateImage` and `batchGenerate` SHALL accept `backend: "gemini" | "pi"`, defaulting to `"gemini"`. The library SHALL NOT read any environment variable to choose the backend; only the CLI does (see `nano-banana-cli-entrypoint`). `"gemini"` SHALL be the existing `@the-focus-ai/nano-banana` CLI path, unchanged in behaviour. `"pi"` SHALL use pi's model runtime, SHALL NOT resolve or require a Gemini key, and SHALL ignore an explicit `apiKey`/`cliKey`. Any other `backend` value SHALL fail with `ok: false` naming `gemini` and `pi`, before any directory is created or generation starts (`batchGenerate`: one such failure per job). Every result of a generation that ran SHALL report the `backend` it used.

#### Scenario: Default stays on Gemini
- **WHEN** no `backend` is passed
- **THEN** the CLI path SHALL run, the result SHALL report `backend: "gemini"`, and pi SHALL NOT be imported

#### Scenario: No Gemini key does not fall back to pi
- **WHEN** no `backend` is passed, no Gemini key resolves, and an OpenRouter credential exists for pi
- **THEN** the result SHALL be the existing no-key failure and pi SHALL NOT be imported

#### Scenario: Environment does not switch library callers
- **WHEN** `process.env.NANO_BANANA_BACKEND` is `"pi"` and a library caller passes no `backend`
- **THEN** the Gemini path SHALL run

#### Scenario: Invalid backend value
- **WHEN** `generateImage` receives `backend: "openai"` with `output: "new-dir/a.png"`
- **THEN** the result SHALL be `ok: false` naming `gemini` and `pi`, neither backend SHALL run, and `new-dir` SHALL NOT be created

### Requirement: pi runtime availability guard

The pi backend SHALL load `@earendil-works/pi-coding-agent` with a dynamic `import()` only on the pi path. It SHALL return `ok: false`, naming the package, the minimum version `1.0.0`, and the found `VERSION` when known, when any of these happens:
- the import fails;
- `VERSION` is below `1.0.0`, compared on its numeric `major.minor.patch`; a prerelease of `1.0.0` (e.g. `1.0.0-rc.1`) counts as below, a non-numeric `VERSION` counts as below;
- `ModelRuntime.create` is not a function;
- `ModelRuntime.create` rejects or throws;
- the created runtime lacks `generateImages`, `getModelOfType` or `getModelsOfType`.

In `batchGenerate`, the guard runs lazily, only once at least one job is not skipped; a guard failure SHALL yield that failure for every non-skipped job. The client SHALL NOT throw or reject for any of these.

#### Scenario: pi not resolvable
- **WHEN** the pi backend runs and the dynamic import rejects
- **THEN** the result SHALL be `ok: false` with an error naming `@earendil-works/pi-coding-agent` and `>= 1.0.0`

#### Scenario: Older pi installed
- **WHEN** the import succeeds with `VERSION` `0.86.1`
- **THEN** the result SHALL be `ok: false` naming `0.86.1` and `1.0.0`
- **AND** `ModelRuntime.create` SHALL NOT be called

#### Scenario: Prerelease of the floor
- **WHEN** the import succeeds with `VERSION` `1.0.0-rc.1`
- **THEN** the result SHALL be `ok: false` naming `1.0.0-rc.1`

#### Scenario: Runtime creation fails
- **WHEN** `ModelRuntime.create` rejects with "auth.json unreadable"
- **THEN** the result SHALL be `ok: false` containing "auth.json unreadable", and the promise SHALL resolve

### Requirement: pi runtime generation

The pi backend SHALL create its runtime with `ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })`. It reads pi's default agent-dir `auth.json`; it SHALL NOT load the user's `models.json` or refresh catalogues, so only the installed pi build's static image catalogue is visible. It SHALL create one runtime per `generateImage` call and exactly one per `batchGenerate` call, shared by its jobs, and SHALL NOT cache runtimes across calls. It SHALL resolve an `openrouter` image model with `getModelOfType`.

It SHALL call `generateImages(model, { input }, { signal, maxRetries: 0 })`, where:
- `input` is the prompt as a text block, preceded by the edit image block when `file` is set;
- `signal` aborts after `timeoutMs` per generation. `timeoutMs` is a new optional client option, default `180000`, used by the pi backend only.

Credentials resolve as pi resolves them (stored `auth.json` credential first, then `OPENROUTER_API_KEY` from the process environment). The caller-supplied `env` SHALL NOT be passed to pi.

A result with `stopReason !== "stop"` SHALL be a failure, with the error truncated to 400 characters and chosen in this order:
1. if the timeout signal has fired, `timed out after <timeoutMs> ms`, plus `: <errorMessage>` when one is present;
2. else if `errorMessage` says the provider is not configured, `errorMessage` plus a hint to run `/login openrouter` in pi or set `OPENROUTER_API_KEY`;
3. else `errorMessage`. The runtime factory SHALL be injectable for tests.

#### Scenario: Generate from prompt
- **WHEN** the pi backend generates with prompt "a red fox" and no file
- **THEN** `generateImages` SHALL receive `input: [{ type: "text", text: "a red fox" }]` and options with `maxRetries: 0`

#### Scenario: Runtime created without refresh or models.json
- **WHEN** the pi backend creates its runtime
- **THEN** `ModelRuntime.create` SHALL receive `modelsPath: null` and `refreshOnCreate: false`

#### Scenario: Batch creates one runtime
- **WHEN** `batchGenerate` runs 5 jobs on the pi backend and none is skipped
- **THEN** the runtime factory SHALL be called once

#### Scenario: Fully skipped batch creates no runtime
- **WHEN** every job of a pi-backend batch has an existing output
- **THEN** the runtime factory SHALL NOT be called and pi SHALL NOT be imported

#### Scenario: Not signed in to OpenRouter
- **WHEN** `generateImages` returns `stopReason: "error"` with `errorMessage: "Provider is not configured: openrouter"`
- **THEN** the error SHALL contain that message and name `/login openrouter` and `OPENROUTER_API_KEY`

#### Scenario: Provider error
- **WHEN** `generateImages` returns `stopReason: "error"` with `errorMessage: "insufficient credits"`
- **THEN** the result SHALL be `ok: false` with error `insufficient credits`

#### Scenario: Timeout
- **WHEN** `timeoutMs` is 50 and the fake runtime resolves `stopReason: "aborted"` with no `errorMessage` once the signal aborts
- **THEN** the result SHALL be `ok: false` with error `timed out after 50 ms`

### Requirement: Edit input validation

For `file`, the pi backend SHALL, before calling `generateImages`:
- match the extension case-insensitively against `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` (mime `image/png`, `image/jpeg`, `image/webp`, `image/gif`);
- report a missing or unreadable file as `ok: false` naming the path.

It SHALL NOT impose its own size limit or resize; provider rejections surface as provider errors. Every refusal SHALL be a result, never a throw.

#### Scenario: Edit an image
- **WHEN** `file` is `in.PNG`
- **THEN** `input` SHALL start with an image block carrying the file's base64 bytes and `mimeType: "image/png"`, followed by the prompt text block

#### Scenario: Unsupported input type
- **WHEN** `file` is `in.heic`
- **THEN** the result SHALL be `ok: false` naming the unsupported type, and `generateImages` SHALL NOT be called

#### Scenario: Missing file
- **WHEN** `file` is `/nope/in.png`
- **THEN** the result SHALL be `ok: false` naming `/nope/in.png`, and the promise SHALL resolve

### Requirement: Model mapping for the pi backend

The pi backend SHALL map `model` as follows:
- a value containing `/` is an OpenRouter id, used as is;
- any other value is prefixed with `google/`;
- with no `model`, `flash` selects `google/gemini-3.1-flash-lite-image`, otherwise `google/gemini-2.5-flash-image`; when `model` is set, `flash` is ignored.

An id that `getModelOfType("image", "openrouter", id)` does not know SHALL fail with an error listing ids from the static `getModelsOfType("image", "openrouter")` catalogue: the `google/` ids for a bare input, all image ids for a slash input. If that list is empty, the error SHALL say the installed pi has no matching image models.

#### Scenario: Default model
- **WHEN** neither `model` nor `flash` is set
- **THEN** the model SHALL be `openrouter` / `google/gemini-2.5-flash-image`

#### Scenario: Bare Gemini id
- **WHEN** `model` is `gemini-3-pro-image`
- **THEN** the model SHALL be `google/gemini-3-pro-image`

#### Scenario: Gemini-CLI-only id
- **WHEN** `model` is `gemini-2.0-flash`
- **THEN** the result SHALL be `ok: false`, and the error SHALL list `google/gemini-2.5-flash-image` and no non-`google/` id

#### Scenario: Mistyped slash id
- **WHEN** `model` is `black-forest-labs/flux.2-pr`
- **THEN** the result SHALL be `ok: false`, and the error SHALL list non-`google/` ids such as `black-forest-labs/flux.2-pro`

### Requirement: Output files and usage

The pi backend SHALL write the first image block of the response to the requested `output` path verbatim (parent directories created; an existing file is overwritten, as on the Gemini path). With no requested path, the first block's name SHALL be `nano-banana-<YYYYMMDD-HHmmss-SSS>.<ext>` in the current directory (local time), with `<ext>` from the block's `mimeType` (`image/png` → `png`, `image/jpeg` → `jpg`, `image/webp` → `webp`, else `png`). Each additional image block SHALL be named `<stem>-2.<ext>`, `<stem>-3.<ext>`, … with `<ext>` from its own `mimeType`.

Every generated (not requested) name — the unnamed first output and every additional block — SHALL use exclusive create. When the name exists, it SHALL take the lowest free `-<n>` suffix (n ≥ 2) and SHALL never overwrite an existing file.

A failure creating the output directory or writing a file SHALL be a result (`ok: false` naming the path and the system error, plus any files already written in `outputs`), never a throw.

The result SHALL carry:
- `output` (first file) and `outputs` (all files, each `{ path, mimeType }`);
- `model` (`provider/id`);
- `usage` from `AssistantImages.usage` when present.

A response with no image block SHALL be a failure, writing no file, whose error is the joined text blocks (up to 400 characters), or `no image returned` when there is no text.

#### Scenario: Two images returned
- **WHEN** the response holds two PNG blocks, `output` is `out/a.png`, and `out/a-2.png` does not exist
- **THEN** `out/a.png` and `out/a-2.png` SHALL be written and `outputs` SHALL list both

#### Scenario: Extra-image name taken
- **WHEN** the response holds two PNG blocks, `output` is `out/a.png`, and `out/a-2.png` already exists
- **THEN** the second image SHALL be written to `out/a-3.png` and `out/a-2.png` SHALL be unchanged

#### Scenario: Concurrent unnamed outputs
- **WHEN** two pi generations without `output` finish in the same millisecond in the same directory
- **THEN** two distinct files SHALL exist and neither SHALL be overwritten

#### Scenario: Unwritable output
- **WHEN** `output` is `/proc/forbidden/a.png` and the directory cannot be created
- **THEN** the result SHALL be `ok: false` naming the path, and the promise SHALL resolve

#### Scenario: Text-only response
- **WHEN** the response holds only a text block "cannot draw that"
- **THEN** the result SHALL be `ok: false` with an error containing "cannot draw that" and no file written

#### Scenario: Empty response
- **WHEN** the response has `stopReason: "stop"` and an empty `output`
- **THEN** the result SHALL be `ok: false` with error `no image returned`

#### Scenario: Usage surfaced
- **WHEN** the response carries `usage.cost.total` 0.039
- **THEN** the result SHALL carry that `usage`

### Requirement: Batch results on the pi backend

`batchGenerate` SHALL resolve the backend once and use it for every job. A job skipped because its output exists SHALL carry no `backend` (no backend ran). A per-job failure SHALL NOT reject the batch.

#### Scenario: Skipped job
- **WHEN** a pi-backend batch skips a job whose output exists
- **THEN** that result SHALL have `skipped: true` and no `backend`

#### Scenario: One job fails
- **WHEN** `generateImages` returns `stopReason: "error"` for one of three pi-backend jobs
- **THEN** the batch SHALL resolve with three results, exactly one `ok: false`

#### Scenario: Guard failure in a batch
- **WHEN** a 3-job pi-backend batch with one existing output runs and the pi import fails
- **THEN** the batch SHALL resolve with the skipped result (`ok: true`, `skipped: true`) and two `ok: false` results naming the package
