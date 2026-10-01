const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const properties = {WEBHOOK_URL: 'https://example.test/webhook', WEBHOOK_SECRET: 'test'};
let failWebhook = true, failAck = false, sequence = 0, appends = 0;
let pending = [];
const markers = [''];
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
  })},
  LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => {}})},
  SpreadsheetApp: {getActiveSpreadsheet: () => ({
    getId: () => '1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E',
    getSheetByName: () => sheet,
  })},
  UrlFetchApp: {fetch: url => {
    if (url.endsWith('/webhook') && failWebhook) throw Error('Exception: Timeout');
    if (url.endsWith('/workspace-ack') && failAck) {
      failAck = false;
      throw Error('Exception: Timeout');
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

const values = Array(18).fill('');
values[17] = 'WORKSPACE:test-registration';
pending = [{registrationId: 'test-registration', tabs: {SIAIO: values}}];
failAck = true;
context.syncWorkspaceRegistrations();
assert.equal(appends, 1);
context.syncWorkspaceRegistrations();
assert.equal(appends, 1, 'retry after an acknowledgement timeout must reuse the marker row');
console.log('Apps Script queue: timeout retry and duplicate prevention passed.');
