## Purpose

Local multimodal inference service that turns text, images, PDF pages, audio and video into vectors in one shared space for kb dense retrieval and cross-modal media retrieval, without sending data off the machine.

## ADDED Requirements

### Requirement: Local-only embedding service

The system SHALL provide an embedding service that runs on the user's machine, listens only on the loopback interface, and requires a per-instance bearer token on every request. The token and port SHALL be published in a user-only-readable state file inside the instance's state directory.

#### Scenario: Request without token is rejected
- **WHEN** a client sends an embed request without the bearer token
- **THEN** the service SHALL respond 401 and SHALL NOT load or run the model

#### Scenario: Service is not reachable off-host
- **WHEN** the service is running
- **THEN** it SHALL be bound to 127.0.0.1 only
- **AND** its state file SHALL be readable only by the owning user

### Requirement: Embed contract

The service SHALL accept a batch of items, each either text or a file reference with a declared modality (image, pdf-page, audio, video) and an optional time window, plus an item kind (`query` or `document`) and an optional task instruction. It SHALL return one L2-normalised vector per item, in input order, together with the model id and vector dimension. The service SHALL NOT persist vectors.

#### Scenario: Mixed-modality batch
- **WHEN** a batch contains one text item and one image item
- **THEN** the response SHALL contain two vectors of the reported dimension, in input order
- **AND** each vector SHALL have unit L2 norm (±1e-3)

#### Scenario: Unknown modality
- **WHEN** an item declares an unsupported modality
- **THEN** the service SHALL respond 400 naming the item index and SHALL NOT embed any item of that batch

### Requirement: File inputs are scoped and bounded

File-reference items SHALL be accepted only when their resolved real path lies under an allowlisted root of that instance. Per-item size and duration limits SHALL be enforced.

#### Scenario: Path outside allowlist
- **WHEN** an item references a path outside every allowlisted root (including via symlink or `..`)
- **THEN** the service SHALL reject the batch with 403 and SHALL NOT read the file

#### Scenario: Oversized media
- **WHEN** an audio or video item exceeds the configured maximum duration without a window
- **THEN** the service SHALL reject that batch with 413

### Requirement: Per-modality encoding correctness gate

The system SHALL provide a validation command that marks a model as validated **per modality**. A modality SHALL be validated only when all of the following pass for it: (a) the rendered model input for fixed fixtures equals a pinned golden rendering of the model's published input template; (b) at least one small public benchmark task for that modality reproduces the publisher-reported score within ±3 points (a text-only model: two text-retrieval tasks); (c) matched-pair cosine exceeds mismatched-pair cosine for at least 90% of pairs. The verdict SHALL persist across restarts and SHALL be reported by the health endpoint. Requests for an unvalidated modality SHALL be rejected with 400.

#### Scenario: Modality validated
- **WHEN** validation runs and all three checks pass for image
- **THEN** the persisted verdict SHALL mark image validated with per-check results

#### Scenario: Subtly wrong recipe
- **WHEN** the smoke check passes for video but benchmark reproduction misses by more than 3 points
- **THEN** video SHALL be unvalidated
- **AND** video embed requests SHALL be rejected with 400 naming the missing validation

### Requirement: Pluggable model and health

The service SHALL load the model named by configuration (default `ATH-MaaS/Ovis-Omni-Embedding-3B`), SHALL NOT materialise speech-generation components, and SHALL expose a health endpoint reporting model id, vector dimension, device, load state, per-modality validation, and a fingerprint of its effective configuration. A text-only model SHALL be loadable for text items only.

#### Scenario: Text-only model given image
- **WHEN** a text-only model is loaded and an image item is submitted
- **THEN** the service SHALL respond 400 stating the modality is unsupported by the loaded model

#### Scenario: Health before load
- **WHEN** health is queried before the first embed
- **THEN** it SHALL report `loaded: false` without triggering a model load

### Requirement: One instance per state directory

At most one service instance SHALL run per state directory. Clients SHALL reuse the instance of their state directory only when it is healthy and its configuration fingerprint (model, allowlisted roots, limits) matches their configuration; otherwise they SHALL restart that instance. Clients using different state directories SHALL NOT affect each other's instances. The service SHALL shut down after a configurable idle period.

#### Scenario: Allowlist changed while running
- **WHEN** the allowlisted roots change in configuration while an instance is live
- **THEN** the next client request SHALL restart the instance before sending any file item

#### Scenario: Two clients start concurrently
- **WHEN** two clients of the same state directory find no live instance at the same time
- **THEN** exactly one instance SHALL be started and both clients SHALL use it

#### Scenario: Evaluation does not disturb the user instance
- **WHEN** an evaluation run needs a wider allowlist than the user's live instance
- **THEN** it SHALL use a separate state directory and the user's instance SHALL keep running unchanged

### Requirement: Explicit weight management

Model weights SHALL be stored under the service's own user directory and downloaded only by an explicit pull command, never implicitly on a search or embed path.

#### Scenario: Weights absent
- **WHEN** an embed is requested and the model weights are not present locally
- **THEN** the service SHALL fail the request with an error naming the pull command
- **AND** SHALL NOT start a download
