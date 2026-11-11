# Validation

## Automated coverage

Run `npm run check` and `npm test`.

The suite validates pure field reconciliation and runs the synchronization orchestrator against simulated Tasks, Sheets, locks, and journal services. It does not authenticate to Google or validate actual spreadsheet rendering, OAuth, trigger execution, or Google's move/conditional-write behavior.

## Live smoke test

Use a new Sheet and two disposable Google Tasks lists. Keep scheduled sync off until the manual checks pass.

1. **Setup and import:** Create tasks with notes, a due date, a completed task, and a parent/subtask pair. Run setup, enable the disposable lists, and import. Check all values, dropdowns, hidden Row ID, and the subtask's parent note. Import again; no duplicates should appear.
2. **Creation:** Enter a new row with a blank list/status, then sync. Verify creation in the first enabled list with Needs action. Repeat sync; no duplicate task should appear. Repeat with a selected destination list and Completed status.
3. **Field updates:** Edit title, notes, and date in each system separately. Clear a date. Complete and reopen a task in each system. Sync after each change and verify both sides.
4. **Cross-list moves:** Change Task List for a standalone task in the Sheet. Verify a native move, returned identity retention, notes, date, and completion. Move it back in Google Tasks and sync. Record whether task IDs remain stable. Try moving a parent/subtask from the Sheet; confirm a clear error and no hierarchy changes.
5. **View integrity:** Sort/filter the entire table. Edit one task and ensure only that Google task changes. Enter text beginning with `=` in Notes through Google Tasks; verify it imports as literal text rather than a formula.
6. **Conflicts:** Edit the same title differently on both sides. Verify no overwrite. Resolve once with SHEET and once with TASKS. Also edit different fields on each side and verify automatic merging.
7. **Deletion:** Set Delete and sync; verify remote deletion and one archive entry. Delete another task remotely; verify archival. Delete remotely while editing locally; verify a conflict with the edits retained. Physically remove a Sheet row; verify restoration without remote deletion.
8. **List changes:** Rename a list remotely and confirm its dropdown/display updates. Disable a list and confirm its existing rows pause. Move a task into a disabled list remotely; verify it pauses when its identity can be matched. Reenable both lists and confirm reconciliation. Do not delete real lists to test this.
9. **Recovery:** In a test copy, temporarily throw an error after a successful API create or move but before the returned ID is saved. Verify the pending journal blocks repeat requests/imports into that destination list. Select the row and link the destination task using Recover selected row; sync and confirm one task/row. Restore the unmodified code afterward.
10. **Scheduling and access:** Enable hourly sync, verify a successful trigger execution and a synchronized disposable edit, then disable it. Confirm another signed-in account cannot run sync. Review the scopes and Apps Script execution log for errors.

If any check fails, keep scheduling off and retain the journal/rows for diagnosis. Do not test recovery or deletion on important tasks.
