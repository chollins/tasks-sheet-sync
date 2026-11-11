/* REST keeps destinationTasklist available independently of advanced-service versions. */
var TaskSyncApi = (function () {
  'use strict';
  function request(method, path, body, query, etag) {
    var suffix = Object.keys(query || {}).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
    }).join('&');
    var options = {
      method: method, muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    };
    if (etag) options.headers['If-Match'] = etag;
    if (body !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
    var response = UrlFetchApp.fetch('https://tasks.googleapis.com/tasks/v1/' + path + (suffix ? '?' + suffix : ''), options);
    var code = response.getResponseCode(), text = response.getContentText();
    if (code < 200 || code >= 300) {
      var error = new Error('Tasks API ' + code + ': ' + text.slice(0, 400));
      error.code = code;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  }
  function path(listId, taskId) {
    return 'lists/' + encodeURIComponent(listId) + '/tasks' + (taskId ? '/' + encodeURIComponent(taskId) : '');
  }
  function pages(resource, query) {
    var items = [], token;
    do {
      var params = Object.assign({}, query || {}, token ? { pageToken: token } : {});
      var page = request('get', resource, undefined, params);
      items = items.concat(page.items || []); token = page.nextPageToken;
    } while (token);
    return items;
  }
  return {
    lists: function () { return pages('users/@me/lists', { maxResults: 100 }); },
    tasks: function (listId) {
      return pages(path(listId), { maxResults: 100, showCompleted: true, showHidden: true, showDeleted: true, showAssigned: true });
    },
    get: function (listId, id) { return request('get', path(listId, id)); },
    create: function (listId, body) { return request('post', path(listId), body); },
    patch: function (listId, id, body, etag) { return request('patch', path(listId, id), body, undefined, etag); },
    move: function (listId, id, destination, etag) {
      return request('post', path(listId, id) + '/move', undefined, { destinationTasklist: destination }, etag);
    },
    remove: function (listId, id, etag) { return request('delete', path(listId, id), undefined, undefined, etag); }
  };
}());
