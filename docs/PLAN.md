# MVP implementation plan

## Architecture

A bound Apps Script application uses the Tasks REST API and a dedicated Sheet. It has six visible columns: Task, Task List, Due Date, Status, Notes, and Sync. Row IDs are hidden; task/list IDs and last synchronized values live in a hidden journal tab. Task List replaces Category and supports native cross-list moves for standalone tasks.

## Milestones

1. **Import and layout:** Repeatable paginated import, enabled-list selection, stable row identity, parent notes, and dropdown validation.
2. **Bidirectional reconciliation:** Create/edit/complete/reopen tasks, merge independent field changes, and support native standalone moves between existing lists.
3. **Safe reconciliation:** Explicit Delete status, archive, same-field conflicts, uncertain-operation recovery, row-removal restoration, and pre-write checks.
4. **Operation:** Setup guide, optional hourly trigger, single-account enforcement, automated regression tests, and live Google acceptance validation.

The initial source implements these milestones; live Google acceptance validation remains to be performed after installation and OAuth authorization.

## Deferred

Recurring-task management, reminders, hierarchy edits, ordering, moving parents/subtasks, task-list creation/deletion, multi-account collaboration, and large-volume incremental synchronization.
