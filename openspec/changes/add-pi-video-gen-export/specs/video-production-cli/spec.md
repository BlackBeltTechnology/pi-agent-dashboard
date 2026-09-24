## MODIFIED Requirements

### Requirement: Subcommand dispatch

The CLI SHALL treat the first positional argument as the subcommand and route the remaining arguments to the matching handler. The recognized subcommands are `parse`, `plan`, `render`, `storyboard`, `export`, and `mux`. The `export` subcommand SHALL take a mode as its next positional argument — `render` or `timeline` — followed by the target.

#### Scenario: Parse subcommand runs the inspector

- WHEN the CLI is invoked with `parse <target>`
- THEN it inspects the shot package and prints a report without calling the Veo API or requiring an API key

#### Scenario: Plan subcommand prints the render plan as a dry run

- WHEN the CLI is invoked with `plan <target>`
- THEN it internally sets the `dry-run` behavior and prints the resolved render plan without making API calls

#### Scenario: Render subcommand renders shots

- WHEN the CLI is invoked with `render <target>`
- THEN it resolves the render plan and, unless `--dry-run` is set, calls the Veo API to render shots to mp4

#### Scenario: Storyboard subcommand generates sketches

- WHEN the CLI is invoked with `storyboard <target>`
- THEN it generates first-frame sketch PNGs for the package's sketch prompts

#### Scenario: Export render subcommand writes a render spec

- WHEN the CLI is invoked with `export render <target>`
- THEN it writes a pi-video-gen `render-input.json` for the package without calling any video API

#### Scenario: Export timeline subcommand writes a timeline spec

- WHEN the CLI is invoked with `export timeline <target> --clips <dir>`
- THEN it writes a pi-video-gen `timeline-input.json` for the package without calling any network service

#### Scenario: Export with unknown or missing mode

- WHEN the CLI is invoked with `export` followed by a mode other than `render` or `timeline`, or no mode
- THEN it prints usage naming both modes to stderr
- AND it exits with code 1

#### Scenario: Export timeline without clips

- WHEN the CLI is invoked with `export timeline <target>` and no `--clips`
- THEN it prints `error: --clips <dir> is required` to stderr
- AND it exits with code 1

#### Scenario: Mux subcommand writes the master

- WHEN the CLI is invoked with `mux <target> --picture <mp4>`
- THEN it mixes the picture with the package's timeline audio and captions into the master mp4

#### Scenario: Unknown subcommand prints usage and fails

- WHEN the CLI is invoked with a subcommand that is not `parse`, `plan`, `render`, `storyboard`, `export`, or `mux`
- THEN it prints a usage message listing the six subcommands to stderr
- AND it exits with code 1

### Requirement: Flag parsing

The CLI SHALL parse arguments into positionals, list flags, value flags, and boolean flags. Arguments not beginning with `--` are positionals. `--shots` and `--only` are list flags that consume all following arguments until the next `--` flag. `--model`, `--resolution`, `--out`, `--parallel`, `--poll`, `--workers`, `--api-key`, `--job`, `--clips`, `--picture`, `--durations`, and `--aspect` are value flags consuming exactly the next argument. Any other `--` argument is a boolean flag.

#### Scenario: List flag consumes multiple values

- WHEN an argument list contains `--shots 01 03A` followed by another `--` flag or the end of arguments
- THEN both `01` and `03A` are collected as the `shots` list

#### Scenario: Value flag consumes one argument

- WHEN an argument list contains `--model fast`
- THEN `fast` is stored as the value of the `model` flag

#### Scenario: New value flags consume one argument

- WHEN an argument list contains `--durations 4-15 --aspect 16:9,9:16 --clips renders`
- THEN `4-15`, `16:9,9:16` and `renders` are stored as the values of `durations`, `aspect` and `clips`

#### Scenario: Boolean flag is a presence toggle

- WHEN an argument list contains `--dry-run`
- THEN the `dry-run` flag is recorded as present with no consumed value

#### Scenario: Out flag meaning per subcommand

- WHEN `--out <path>` is passed
- THEN `render` treats it as the clip output dir, `export` as the job output dir, and `mux` as the master output file

#### Scenario: Malformed durations flag

- WHEN `--durations` is not of the form `<int>-<int>` with min ≤ max
- THEN the CLI prints an error naming the flag to stderr
- AND it exits with code 1

### Requirement: Required target

Every subcommand SHALL require a `<target>` positional argument identifying a project dir, video_production dir, or shots dir. For `export` the target is the positional after the mode (`export <mode> <target>`); for every other subcommand it is the positional after the subcommand.

#### Scenario: Missing target aborts

- WHEN a subcommand is invoked with no positional target
- THEN it prints `error: missing <target>` guidance to stderr
- AND it exits with code 1

#### Scenario: Export mode is not taken as the target

- WHEN the CLI is invoked with `export render` and no further positional
- THEN it prints `error: missing <target>` guidance to stderr
- AND it exits with code 1
