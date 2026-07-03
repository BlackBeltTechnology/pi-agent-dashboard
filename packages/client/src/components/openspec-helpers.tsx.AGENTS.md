# openspec-helpers.tsx — index

Shared OpenSpec UI helpers. Exports `LETTER_MAP`, `artifactLetter(id)`, `statusColor(status)`, `ArtifactLetters`, `ArtifactLettersButton`, `allArtifactsDone(artifacts)`. Maps artifact ids (proposal/design/specs/tasks) → single letters; colors by `done`/`ready` status; buttons call `onReadArtifact(changeName, artifactId)`.
