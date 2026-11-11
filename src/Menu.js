function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tasks Sync')
    .addItem('Set up / refresh lists', 'setupTasksSync')
    .addItem('Sync now / import tasks', 'syncTasksNow')
    .addSeparator()
    .addItem('Resolve selected row', 'resolveTaskRow')
    .addItem('Recover selected row', 'recoverTaskRow')
    .addSeparator()
    .addItem('Enable hourly sync', 'enableHourlyTaskSync')
    .addItem('Disable scheduled sync', 'disableScheduledTaskSync')
    .addToUi();
}
function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== 'Tasks' || e.range.getColumn() > 5) return;
  var first = Math.max(2, e.range.getRow()), last = e.range.getLastRow();
  if (last < first) return;
  e.range.getSheet().getRange(first, 6, last - first + 1).setValue('Pending');
}
function taskSyncUi_(fn) {
  try { return fn(); }
  catch (e) { SpreadsheetApp.getUi().alert('Tasks Sync', e.message, SpreadsheetApp.getUi().ButtonSet.OK); }
}
function setupTasksSync() {
  taskSyncUi_(function () {
    TaskSync.setup();
    SpreadsheetApp.getUi().alert('Ready. Choose enabled lists on the Task Lists tab, then use Sync now. The first enabled list is the default for new tasks.');
  });
}
function syncTasksNow() { taskSyncUi_(function () { TaskSync.run(); }); }
function scheduledTasksSync() {
  // Trigger errors remain visible in Apps Script Executions; no modal UI.
  TaskSync.run();
}
function resolveTaskRow() {
  taskSyncUi_(function () {
    var d = TaskSync.details(), c = d.meta.conflict;
    if (!c) throw new Error('No recorded conflict. Run Sync now first.');
    var ui = SpreadsheetApp.getUi();
    var remote = c.remote ? JSON.stringify(c.remote, null, 2) : '(Deleted remotely)';
    var result = ui.prompt('Resolve task conflict',
      'Conflicting fields: ' + c.fields.join(', ') + '\n\nGoogle Tasks version:\n' + remote +
      '\n\nType SHEET to retain conflicting Sheet values, or TASKS to accept this Google Tasks version. Cancel makes no changes.', ui.ButtonSet.OK_CANCEL);
    if (result.getSelectedButton() !== ui.Button.OK) return;
    var choice = result.getResponseText().trim().toUpperCase();
    if (!['SHEET', 'TASKS'].includes(choice)) throw new Error('Enter SHEET or TASKS.');
    TaskSync.resolve(d.id, choice === 'SHEET' ? 'local' : 'remote');
  });
}
function recoverTaskRow() {
  taskSyncUi_(function () {
    var d = TaskSync.details();
    if (!d.meta.pending) throw new Error('This row has no uncertain operation.');
    var pending = d.meta.pending, ui = SpreadsheetApp.getUi();
    var candidates = pending.kind === 'delete' ? [] : TaskSync.recoveryCandidates(d.id);
    var text = candidates.map(function (c, i) {
      return (i + 1) + '. ' + c.task.title + ' | ' + (c.task.due || 'No date') + ' | ID: ' + c.task.id;
    }).join('\n');
    if (text.length > 12000) throw new Error('Too many recovery candidates. Inspect the pending operation in _Sync and narrow the destination list before recovery.');
    var response = ui.prompt('Recover ' + pending.kind,
      'The previous request may already have succeeded. Check Google Tasks first.\n\n' + text +
      '\n\nEnter a number to link this row to the correct destination task. Enter RETRY only after verifying the operation did not succeed. Retrying an uncertain creation can duplicate a task.', ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) return;
    var answer = response.getResponseText().trim();
    if (answer.toUpperCase() === 'RETRY') TaskSync.recover(d.id, null, true);
    else {
      var index = Number(answer) - 1;
      if (!Number.isInteger(index) || !candidates[index]) throw new Error('Invalid candidate number.');
      TaskSync.recover(d.id, candidates[index], false);
    }
  });
}
function enableHourlyTaskSync() {
  taskSyncUi_(function () {
    TaskSync.assertOwner(false);
    disableScheduledTaskSync_();
    ScriptApp.newTrigger('scheduledTasksSync').timeBased().everyHours(1).create();
    SpreadsheetApp.getActiveSpreadsheet().toast('Hourly synchronization enabled.', 'Tasks Sync');
  });
}
function disableScheduledTaskSync_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scheduledTasksSync') ScriptApp.deleteTrigger(t);
  });
}
function disableScheduledTaskSync() {
  taskSyncUi_(function () { TaskSync.assertOwner(false); disableScheduledTaskSync_(); });
}
