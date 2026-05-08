## Why

SessionCard разрослась до 12 визуальных строк и двух независимых рендер-путей (desktop/mobile). Карточка смешивает показ состояния с интерактивными действиями (OpenSpec attach, flow launcher, plugin slots, process list), что перегружает список сессий. FolderActionBar состоит из 5-7 кнопок в строку, нечитаем на мобильных экранах. Нужен единый mobile-first дизайн, который показывает только состояние сессии, а действия переносит в детализацию.

## What Changes

- **SessionCard**: Единый mobile-first рендер вместо двух веток (desktop/mobile). Адаптивная вёрстка скрывает/показывает элементы через CSS. Карточка — только превью состояния.
- **Убрано из карточки**: Token stats, flow badge, flow launcher, OpenSpec actions (attach/detach), plugin slots, process list, drag-to-reorder, inline rename
- **Убрано из mobile-карточки**: Source icon, activity indicator, context usage bar, OpenSpec badge, resume/fork кнопки, rename/hide/shutdown кнопки, время
- **Meta-информация в чипсах**: Git branch, worktree, attached proposal — компактные пилюли в одной строке вместо отдельных строк
- **Cost ($)**: Скрывается когда равен 0
- **FolderActionBar**: Только +Session и +Worktree на виду. Terminals, Editor, native editors, Pi Resources — в выпадающем меню «Инструменты» (desktop). На mobile — только +Session и +Worktree.
- **README button**: Убрана из заголовка папки (везде)
- **PlaceholderSessionCard**: Редизайн в общем стиле

## Capabilities

### New Capabilities

- `session-card-redesign`: Минималистичная mobile-first карточка сессии — единый адаптивный рендер, Apple-style визуальный язык (blur, мягкие тени, воздух), чипсы для meta-информации, чёткая визуальная иерархия из 4-5 строк
- `folder-action-bar-redesign`: Упрощённая панель действий папки — основные экшены на виду, второстепенные в выпадающем меню «Инструменты» (desktop), только основные на mobile

### Modified Capabilities

- `folder-action-bar`: Полная замена — новый набор кнопок и их расположение
- `session-listing`: Изменение компоновки карточек в списке, удаление drag-to-reorder
- `session-rename`: Удаление inline-переименования из карточки
- `session-process-tracking`: ProcessList убран из карточки
- `token-stats-pipeline`: Token stats убраны из карточки
- `placeholder-spawn-card`: Визуальное обновление скелетона
- `session-grouping`: Удаление drag-to-reorder
- `git-context`: Git branch отображается чипсом в карточке (дополнительно к GroupGitInfo на уровне папки)
- `proposal-attachment`: Attached proposal отображается чипсом
- `openspec-card-section`: OpenSpec badge остаётся (desktop only), OpenSpec actions убраны
- `context-usage-bar`: Desktop-only в карточке
- `sidebar-header`: Удаление README button

## Impact

- **Affected code**: `SessionCard.tsx`, `SessionList.tsx`, `FolderActionBar.tsx`, `SortableSessionCard.tsx`, `PlaceholderSessionCard.tsx`, `SidebarFolderSectionSlot` (README button)
- **Dependencies**: `@dnd-kit` может быть удалён если drag нигде больше не используется
- **Breaking**: Drag-to-reorder сессий удалён; inline rename удалён; README button из заголовка папки удалён
