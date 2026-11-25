const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const properties = {WEBHOOK_URL: 'https://example.test/webhook', WEBHOOK_SECRET: 'test'};
let failWebhook = true, failAck = false, pendingFailure = null, sequence = 0, appends = 0;
let pending = [];
const markers = [''];
const logged = [];
let failLog = false;
const logSheet = {appendRow: row => {
  if (failLog) throw Error('Sheet is busy');
  logged.push(row);
}};
const sheet = {
  getName: () => 'SIAIO', getLastRow: () => markers.length + 1,
  getMaxColumns: () => 18, getLastColumn: () => 18,
  getRange: (first, column, count) => ({
    getDisplayValue: () => 'Mã đăng ký Workspace', setValue: () => {},
    getDisplayValues: () => column === 18
      ? markers.slice(first - 2, first - 2 + count).map(value => [value])
      : Array.from({length: count}, () => ['01/10/2026', 'test@example.test', 'Test Candidate']),
  }),
  appendRow: values => { markers.push(values[17]); appends++; },
};
const context = {
  console: {warn: () => {}, error: () => {}, log: () => {}},
  Date, JSON, Utilities: {getUuid: () => String(++sequence)},
  PropertiesService: {getScriptProperties: () => ({
    getProperty: key => properties[key],
    setProperty: (key, value) => {properties[key] = value;},
    deleteProperty: key => {delete properties[key];},
    getProperties: () => ({...properties}),
    setProperties: values => {Object.assign(properties, values);},
  })},
  LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => {}})},
  SpreadsheetApp: {getActiveSpreadsheet: () => ({
    getId: () => '1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E',
    getSheetByName: name => name === '_SYNC_LOG' ? logSheet : name === 'Gone' ? null : sheet,
  })},
  UrlFetchApp: {fetch: url => {
    if (url.endsWith('/webhook') && failWebhook) throw Error('Exception: Timeout');
    if (url.endsWith('/workspace-ack') && failAck) {
      failAck = false;
      throw Error('Exception: Timeout');
    }
    if (url.endsWith('/workspace-pending') && pendingFailure) {
      if (pendingFailure instanceof Error) throw pendingFailure;
      return {getResponseCode: () => pendingFailure, getContentText: () => ''};
    }
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify(
      url.endsWith('/workspace-pending') ? {registrations: pending} : {}
    )};
  }},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8'), context);
const book = context.SpreadsheetApp.getActiveSpreadsheet();
context.onRegistrationEdit({source: book, range: {getSheet: () => sheet, getRow: () => 2, getNumRows: () => 1}});
assert.equal(Object.keys(properties).filter(key => key.startsWith('REG_DIRTY_')).length, 1);
failWebhook = false;
context.syncWorkspaceRegistrations();
assert.equal(Object.keys(properties).filter(key => key.startsWith('REG_DIRTY_')).length, 0);
assert.deepEqual(logged.map(row => row[1]), ['Gửi lại toàn bộ', 'Phiên bản mới'], 'a new version re-sends every row once and proves it is live');
assert.equal(properties.WORKSPACE_FULL_RESYNC_VERSION, '2026-11-25');
context.syncWorkspaceRegistrations();
assert.equal(logged.filter(row => row[1] === 'Gửi lại toàn bộ').length, 1, 'the full re-send runs once per version');

const values = Array(18).fill('');
values[17] = 'WORKSPACE:test-registration';
pending = [{registrationId: 'test-registration', tabs: {SIAIO: values}}];
failAck = true;
context.syncWorkspaceRegistrations();
assert.equal(appends, 1);
context.syncWorkspaceRegistrations();
assert.equal(appends, 1, 'retry after an acknowledgement timeout must reuse the marker row');

const failedRuns = () => Number(properties.WORKSPACE_FAILED_SYNC_RUNS || 0);
pendingFailure = Error('Exception: Address unavailable: https://example.test/workspace-pending');
for (let run = 1; run <= 5; run++) {
  context.syncWorkspaceRegistrations();
  assert.equal(failedRuns(), run, 'a short network drop must not fail the trigger');
}
assert.throws(() => context.syncWorkspaceRegistrations(), /Address unavailable/, 'an hour of failed runs must alert');
pendingFailure = 502;
assert.throws(() => context.syncWorkspaceRegistrations(), /502/);
pendingFailure = null;
context.syncWorkspaceRegistrations();
assert.equal(failedRuns(), 0, 'a good run clears the failure count');
assert.equal(logged.filter(row => row[1] === 'Lỗi tạm thời').length, 8, 'every failed run is logged, including the ack timeout above');
assert.match(logged[logged.length - 1][2], /Sau 7 lượt/, 'recovery is logged');

pendingFailure = 502;
context.syncWorkspaceRegistrations();
assert.equal(failedRuns(), 1, 'a gateway error is retried like a network drop');
pendingFailure = null;
context.syncWorkspaceRegistrations();

pendingFailure = 403;
assert.throws(() => context.syncWorkspaceRegistrations(), /403/, 'a rejected secret must alert at once');
assert.equal(failedRuns(), 0);
assert.equal(logged[logged.length - 1][1], 'Lỗi');
pendingFailure = Error('Exception: Address unavailable: https://example.test/workspace-pending');
failLog = true;
context.syncWorkspaceRegistrations();
assert.equal(failedRuns(), 1, 'a broken log must not change how the sync behaves');
failLog = false;
pendingFailure = null;
context.syncWorkspaceRegistrations();

const originalFetch = context.UrlFetchApp.fetch;
context.UrlFetchApp.fetch = (fetch => url => {
  if (url.endsWith('/webhook')) throw Error('Exception: Address unavailable: ' + url);
  return fetch(url);
})(originalFetch);
context.onRegistrationEdit({source: book, range: {getSheet: () => sheet, getRow: () => 2, getNumRows: () => 1}});
const queued = () => Object.keys(properties).filter(key => key.startsWith('REG_DIRTY_'));
assert.equal(queued().length, 1, 'the edited row stays queued');

// Overlapping edits collapse into one job per continuous row range.
for (const key of queued()) delete properties[key];
for (let i = markers.length; i < 130; i++) markers.push('');
const queueJob = (first, count, createdAt, tab = 'SIAIO') => {
  properties['REG_DIRTY_' + (++sequence)] = JSON.stringify({tab, first, count, createdAt});
};
queueJob(2, 3, 1); queueJob(4, 3, 2); queueJob(7, 1, 3); queueJob(20, 1, 4);
for (let i = 0; i < 40; i++) queueJob(2, 1, 10 + i);
context.compactRegistrationQueue_(context.PropertiesService.getScriptProperties());
assert.deepEqual(queued().map(key => JSON.parse(properties[key])).map(job => [job.first, job.count, job.createdAt]).sort((a, b) => a[0] - b[0]),
  [[2, 6, 1], [20, 1, 4]], 'adjacent and repeated ranges merge, keeping the oldest time');

// A job Workspace rejects must not hold back the others or the Workspace pull.
let sentRows = [];
context.UrlFetchApp.fetch = (url, options) => {
  if (url.endsWith('/webhook')) {
    const rows = JSON.parse(options.payload).rows.map(row => row.rowNumber);
    if (rows.includes(2)) return {getResponseCode: () => 500, getContentText: () => 'boom'};
    sentRows.push(...rows);
  }
  return originalFetch(url);
};
pending = [{registrationId: 'second-registration', tabs: {SIAIO: Object.assign(Array(18).fill(''), {17: 'WORKSPACE:second-registration'})}}];
assert.throws(() => context.syncWorkspaceRegistrations(), /500/, 'a server bug is still reported');
assert.deepEqual(sentRows, [20], 'the healthy job was sent after the failing one');
assert.equal(appends, 2, 'the Workspace pull ran despite the failing job');
assert.equal(queued().length, 1, 'only the failing job stays queued');

// Large ranges go out in small batches and drain in one run.
for (const key of queued()) delete properties[key];
sentRows = [];
const batchSizes = [];
context.UrlFetchApp.fetch = (url, options) => {
  if (url.endsWith('/webhook')) batchSizes.push(JSON.parse(options.payload).rows.length);
  return originalFetch(url);
};
queueJob(3, 120, 1);
context.syncWorkspaceRegistrations();
assert.deepEqual(batchSizes, [50, 50, 20]);
assert.equal(queued().length, 0);

// Google's own storage/server errors are transient, not an alert per run.
context.UrlFetchApp.fetch = (url, options) => {
  if (url.endsWith('/webhook')) throw Error("We're sorry, a server error occurred. Please wait a bit and try again.");
  return originalFetch(url);
};
queueJob(3, 1, 1);
context.syncWorkspaceRegistrations();
assert.equal(failedRuns(), 1, 'a Google server error waits for the next run');
assert.equal(queued().length, 1);

// A job for a deleted tab is dropped instead of failing forever.
context.UrlFetchApp.fetch = originalFetch;
for (const key of queued()) delete properties[key];
queueJob(3, 1, 1, 'Gone');
context.syncWorkspaceRegistrations();
assert.equal(queued().length, 0);
assert.equal(failedRuns(), 0);
assert.ok(logged.some(row => row[1] === 'Bỏ lô' && /Gone/.test(row[2])));
console.log('Apps Script queue: timeout retry, failure alert, isolated batches and duplicate prevention passed.');
