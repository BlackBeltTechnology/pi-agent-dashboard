# developer-workflow Specification

## Purpose

Protocol for handling large-divergence rebases with safety guarantees. Defines backup, conflict-resolution, verification, and push rules for rebase operations where local and upstream commit counts exceed heuristic thresholds.

## Requirements

### Requirement: Large-divergence rebase SHALL follow the pre-rebase backup + interactive + verification protocol

When a local branch has 10 or more commits ahead of its upstream AND the upstream has 30 or more commits ahead of the local merge-base, the developer SHALL execute the rebase using the protocol documented in this capability's `design.md`. The protocol mandates: (1) backup branch creation before starting, (2) interactive rebase (`git rebase -i`) rather than auto rebase or merge, (3) per-conflict resolution rules documented in advance, (4) post-rebase verification gates (type-check, tests, openspec validate, build) BEFORE push, (5) plain `git push` without `--force-with-lease` because local-only commits are fast-forwardable.

The threshold (10 local / 30 upstream) is a heuristic — smaller divergences can use any merge strategy. The protocol applies when blast radius justifies the ceremony.

#### Scenario: Backup branch created before rebase

- **WHEN** a developer begins a large-divergence rebase
- **THEN** they SHALL create a recoverable branch `develop-prerebase-<timestamp>` BEFORE running `git rebase`
- **AND** the backup SHALL be deletable only after the post-rebase verification gates pass AND `git push` succeeds

#### Scenario: Conflict resolution rules documented before rebase starts

- **WHEN** the rebase's `design.md` predicts HIGH-risk conflicts (file overlap with structural rewrites on the upstream side)
- **THEN** the design SHALL include a per-file resolution recipe naming the upstream commits, our commits, the conflict line ranges, and the chosen resolution
- **AND** the developer SHALL apply those recipes verbatim during conflict resolution rather than deciding ad-hoc

#### Scenario: Verification gates block push on failure

- **WHEN** post-rebase verification (type-check / tests / openspec validate / build) reports ANY failure introduced by the rebase
- **THEN** the developer SHALL NOT push
- **AND** SHALL either fix forward on the rebased branch OR abort via `git reset --hard <backup-branch>` and re-plan

#### Scenario: Plain push without force flag

- **WHEN** local-only commits (never published) are rebased onto upstream
- **THEN** `git push origin <branch>` SHALL succeed as a fast-forward
- **AND** the developer SHALL NOT use `--force` or `--force-with-lease` because rewriting local-only SHAs does not require publishing-history rewrite
- **AND** if the push fails as non-fast-forward, the failure indicates upstream moved during the rebase; the developer SHALL `git fetch` and re-rebase rather than force-push
