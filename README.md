# Tasks Sheet Sync

A Google Apps Script application that uses Google Sheets as a desktop interface for Google Tasks. Edit tasks, notes, dates, completion, and task-list membership in either system, then reconcile them with **Tasks Sync → Sync now**.

**Status:** MVP implementation. Automated tests use simulated Google services. A live Google account smoke test is required before using it with important tasks.

## What it does

- Imports existing tasks, including completed tasks and subtasks.
- Creates, edits, completes, and reopens tasks in both directions.
- Moves standalone tasks between existing task lists using the native API.
- Merges independent field changes and flags conflicting changes for review.
- Deletes only through an explicit `Delete` status; retains an archive.
- Restores accidentally removed Sheet rows instead of deleting their Google tasks.
- Journals uncertain creations and moves so retries cannot silently create duplicate rows.
- Offers manual sync and optional hourly sync.

## Sheet layout

| Column | Use |
| --- | --- |
| Task | Required title |
| Task List | Existing-list dropdown; editable for standalone tasks |
| Due Date | `YYYY-MM-DD`, or a Sheet date; no time component |
| Status | `Needs action`, `Completed`, or `Delete` |
| Notes | Plain text |
| Sync | System status, errors, and conflict guidance |

The protected-with-warning **Row ID** column is hidden. Do not edit or copy it when creating a task. To create a similar task, copy only the five editable columns into a new row.

Other tabs:

- **Task Lists:** Check Enabled for lists to import and modify. The first enabled list is the default for new tasks with a blank Task List. Newly discovered lists start enabled; adjust before the next sync.
- **Archive:** Recoverable copies of deleted rows. To recreate one, copy its editable cells to a new Tasks row and change Status from Delete if needed.
- **_Sync:** Hidden synchronization baselines and operation journal. Do not edit or remove this tab. It contains task content and belongs to the same privacy boundary as the spreadsheet.

Existing subtasks get a parent-ID note on the Task cell. Sorting/filtering changes only the Sheet view. Always sort the entire table; sorting one column independently separates task values from their identities.

## Install in a spreadsheet

No web-app deployment, API key, or external server is needed.

1. Create a **new Google Sheet**, signed into the Google account whose Tasks you want to synchronize.
2. Open **Extensions → Apps Script**.
3. Create script files named `Core`, `Api`, `Sheets`, `Sync`, and `Menu`. Paste each corresponding file from [`src/`](src/). Remove the empty default `Code.gs` if unused. Apps Script displays script files with `.gs` extensions; the source uses `.js` for local tooling.
4. In Apps Script **Project Settings**, enable **Show "appsscript.json" manifest file in editor**. Replace its contents with [`src/appsscript.json`](src/appsscript.json).
5. Ensure the **Google Tasks API** is enabled for the associated Google Cloud project. For a default Apps Script Cloud project, add **Tasks API** under **Services → +** to enable it automatically. With a standard Cloud project, enable the API in Cloud Console. The implementation calls REST directly; adding the advanced service is only a convenient enablement step.
6. Save, then run `setupTasksSync` from the editor. Review and authorize the requested access. Only the account that first completes setup can synchronize this spreadsheet.
7. Reload the Sheet. On **Task Lists**, choose enabled lists. Then select **Tasks Sync → Sync now / import tasks**.
8. Complete the [live smoke test](docs/VALIDATION.md) using disposable tasks before normal use.

No live Google data is modified merely by installing the files or running setup. **Sync now** imports existing tasks and applies any edits already present in the Tasks tab.

### Optional clasp workflow

If you already use Google's `clasp` CLI, create a bound script through the Sheet first, then create an ignored `.clasp.json` at the repository root:

```json
{
  "scriptId": "YOUR_BOUND_SCRIPT_ID",
  "rootDir": "src"
}
```

Authenticate using your own Google account, enable the Apps Script API if requested by clasp, and run `clasp push`. The script ID is in Apps Script Project Settings. Do not commit authentication files. The source directory is the upload root; only its JavaScript and manifest files are needed. The manual installation above requires no CLI dependencies.

## Daily use

1. Edit the first five columns, or enter a new Task on an empty row.
2. Choose **Sync now**. Blank Status defaults to Needs action; blank Task List on a new row uses the first enabled list.
3. Review the Sync column. User edits mark rows Pending; scheduled synchronization is optional.
4. To delete, select Status **Delete**, then sync. Successful deletions move to Archive.
5. To schedule, choose **Enable hourly sync**. This installs a trigger under the setup account. Disable it from the same menu. Trigger failures appear in Apps Script **Executions**.

For a conflict, select one cell in the task row and choose **Resolve selected row**:

- `SHEET`: Keep the current Sheet values for conflicting fields, then run sync again. Unrelated remote edits can still merge.
- `TASKS`: Accept the recorded Google Tasks version for the whole row, or accept its deletion.
- Cancel: Preserve both versions without changing the task.

If the remote task changed again, resolution stops and requests another sync. To keep local edits after a remote deletion, copy the editable cells into a **new row** before accepting the remote deletion.

### Interrupted creation or move

An API request can succeed even if its response is lost. The application saves its intent before the request and **does not automatically repeat an uncertain creation or move**. New imports into that destination list pause until recovery.

Select the affected row and choose **Recover selected row**. Inspect Google Tasks, then select the correct destination task from the numbered candidates. Alternatively, enter `RETRY` only after verifying the operation did not succeed. An incorrectly authorized creation retry can create a duplicate. Interrupted deletes are reconciled automatically if the task is gone; if it remains, recovery permits a deliberate retry.

## Synchronization design

- `Core.js`: Pure three-way comparison of Sheet, remote task, and last synchronized baseline.
- `Api.js`: Paginated Tasks REST client, including native cross-list moves and conditional write headers.
- `Sheets.js`: Sheet layout, validation, literal text writes, row identity, journal, and archival.
- `Sync.js`: Locked reconciliation, pre-write checks, operation recovery, and single-account enforcement.
- `Menu.js`: Menus, pending edit indicators, conflict/recovery prompts, and scheduled triggers.

Every run fully fetches **all existing lists** before mutation, including disabled lists. This lets it recognize a same-ID move into a disabled list instead of mistaking the move for deletion. Disabled lists are read-only, excluded from new imports, and not valid Sheet move destinations. Rows whose source list is disabled or unavailable pause. Enable the relevant lists to resume.

Tasks are matched by IDs, not titles. Moves originating in Google Tasks are matched across lists when the ID is preserved. If a move changes the ID and no local move journal links it, it appears as an old-task deletion plus a new import; pending local edits on the old row remain a conflict. Tasks moved into an unavailable list cannot always be distinguished from deletions. List deletion itself pauses affected rows rather than deleting them from the Sheet.

The baseline advances only after a confirmed result. After a move, the returned identity is saved immediately while the prior field baseline is retained until remaining edits complete. Before remote writes, the application rereads the task, compares its version and values, and sends `If-Match` where available. This is not a transaction spanning Google Tasks and Sheets; a concurrent remote edit can still race a request. Sheet edits detected during a run remain pending rather than being replaced.

## Scope and limitations

- One Google account per spreadsheet; collaborators do not gain permission to run the owner's synchronization.
- Due dates are date-only. Recurrence and reminders are not managed.
- New tasks are top-level. Hierarchy editing, task reordering, and cross-list moves of parents/subtasks are excluded. Assigned-task operations may be rejected by Google; row errors retain the edits.
- Existing list selection is supported; creating, deleting, and reorganizing lists is done in Google Tasks.
- Recurring tasks cannot be moved across lists through this API. The API does not expose a general recurrence field for this app to manage; avoid editing recurring tasks through this MVP.
- Polling introduces delay. No push notifications or background server are used.
- Intended for modest personal task volumes. Full reads and per-row journaling consume Apps Script runtime and API quotas. Runs stop starting row work after roughly four minutes; exceptionally large initial fetches can still exceed runtime limits. Use fewer tasks or optimize batching before larger deployments.
- System-field protections show a warning; the spreadsheet owner can override them. Hidden metadata is not a security boundary.
- Renaming application tabs, altering headers, or deleting metadata is unsupported. Use a dedicated Sheet and keep backups. Archive is retained indefinitely.

## Development

Node.js 20+ is sufficient; no npm dependencies are required.

```sh
npm run check
npm test
```

Tests exercise reconciliation and simulated end-to-end synchronization, including uncertain operations, failed writes after moves, disabled lists, deletion, sorting, and concurrent Sheet edits. GitHub Actions runs the same checks. See [validation](docs/VALIDATION.md) for Google-specific acceptance checks and [the project plan](docs/PLAN.md) for milestones.
