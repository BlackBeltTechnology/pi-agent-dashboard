# BranchSwitchDialog.tsx — index

Modal dialog for git branch switch. Exports `BranchSwitchDialog`. State machine `Step` = pick / no-git / dirty / switching / ask-pop / error. Calls `checkoutBranch`, `stashPop`, `gitInit` from `lib/git-api`. Embeds `BranchPicker`.
