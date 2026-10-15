# craft-verify Specification

## Purpose
Give agents a mechanical, scriptable check that an artefact produced by a craft app (or any pipeline step) actually has the expected properties — duration, streams, alpha, loudness, dimensions, page count, visible content — so silently wrong outputs are caught at the step that produced them instead of by a human at the end.

## Requirements

### Requirement: Invocation and exit codes
`pi-craft verify <file> [assertions…] [--json]` SHALL evaluate every given assertion against the file and print a report listing each assertion with expected value, actual value and pass/fail. Exit codes SHALL be `0` all assertions pass, `1` at least one fails or the file is missing/unreadable, `2` usage error (unknown assertion, malformed value, no assertion given), `3` a probe tool required by a requested assertion is unavailable (the report names the tool). `--json` SHALL print the report as one JSON object.

#### Scenario: All pass
- **WHEN** `pi-craft verify final.mp4 --duration 5±0.1 --has-video --has-audio` runs on a 5.0 s h264+aac file
- **THEN** every assertion passes and the exit code is `0`

#### Scenario: Wrong duration is caught
- **WHEN** the same command runs on a 10.0 s file
- **THEN** the duration assertion fails showing expected `5±0.1` and actual `10.0`, and the exit code is `1`

#### Scenario: Probe tool missing
- **WHEN** `--loudness` is requested and `ffmpeg` is not on PATH
- **THEN** the report names `ffmpeg` and the exit code is `3`

### Requirement: Media assertions
The command SHALL support `--duration <s>[±tol]` (default tolerance 0.05 s), `--has-video`, `--has-audio`, `--no-audio`, `--size <W>x<H>`, `--fps <n>`, `--codec <video|audio>=<name>`, `--alpha` (video or image has an alpha channel), `--loudness <LUFS>[±tol]` (integrated, default tolerance 1 LU), `--max-peak <dBFS>` (sample peak at or below), and `--silent-below <dBFS>` (passes only when the file's maximum volume is below the threshold, i.e. the file is effectively silent).

#### Scenario: Alpha render
- **WHEN** `pi-craft verify title.mov --alpha --size 1280x720` runs on a ProRes 4444 render with an alpha channel
- **THEN** both assertions pass

#### Scenario: Peak over budget
- **WHEN** `--max-peak -1` is asserted on a file whose sample peak is −0.2 dBFS
- **THEN** the assertion fails showing the actual peak

### Requirement: Visual content assertion
The command SHALL support `--frame-diff <t>:<ref>[@<rt>]<op><pct>` comparing the frame of the file at time `t` (seconds; still images ignore `t`) with the frame of `ref` at `rt` (default `t`), where the difference is the percentage of pixels whose luma differs by more than 40 of 255, and `<op>` is `>` (content must differ, e.g. an overlay is present) or `<` (content must match).

#### Scenario: Overlay present
- **WHEN** `--frame-diff 3:clip.mp4>0.5` is asserted on a render whose title overlay changes 1.45 % of pixels at 3 s
- **THEN** the assertion passes

#### Scenario: Overlay absent where expected
- **WHEN** `--frame-diff 0.2:clip.mp4<0.1` is asserted and the frames are identical
- **THEN** the assertion passes

### Requirement: Document assertions
For PDF files the command SHALL support `--pages <n>` and `--text-contains <string>`, using the PdfCraft CLI (provisioned on demand); a provisioning failure SHALL be reported as exit `3` naming `pdfcraft`.

#### Scenario: Page count
- **WHEN** `pi-craft verify report.pdf --pages 12` runs on a 12-page PDF
- **THEN** the assertion passes
