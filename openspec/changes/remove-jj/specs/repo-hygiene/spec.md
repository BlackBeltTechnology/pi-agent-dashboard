## REMOVED Requirements

### Requirement: Repo MUST ignore jj workspace directories

**Reason**: Jujutsu (jj) workspace plugin and all jj support have been removed from the project. The `.shadow/` directory convention was exclusively used by `jj workspace add`. Without jj, there are no jj workspace clones to exclude.

**Migration**: Remove `.shadow/` from the repo-root `.gitignore`. If other tooling uses `.shadow/`, the entry can be re-added under a generic rationale.
