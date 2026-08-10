# openspec-archive.ts — index

Scans `openspec/changes/archive/` for dated entries. Exports `scanOpenSpecArchive(cwd)` returning `ArchiveEntry[]` with name, date, artifacts (proposal/design/tasks/specs existence). Returns newest-first; empty on missing dir.
