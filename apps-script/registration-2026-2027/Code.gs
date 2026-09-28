/**
 * Bound script for the private form workbook "Phiếu đăng ký cá nhân tham dự các
 * cuộc thi năm học 2026–2027". It reads rows under the signed-in Sheet owner
 * and sends them to FT Workspace; the Sheet does not need public sharing.
 *
 * Script Properties (Project settings):
 *   WEBHOOK_URL = https://workspace.fermat.vn/api/examination/form-registration/webhook
 *   WEBHOOK_SECRET = same value as EXAMINATION_REGISTRATION_WEBHOOK_SECRET on server
 * Run installRegistrationTriggers() once, then syncAllRegistrations() once.
 */
var REGISTRATION_SPREADSHEET_ID = '1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E';
var REGISTRATION_TABS = ['SIAIO', 'SIPhO, SIChO, SIBO, SILSO', 'FIMO, FIEO'];

function sendRegistrationRows_(sheet, firstRow, count) {
  if (!sheet || REGISTRATION_TABS.indexOf(sheet.getName()) < 0 || count < 1) return;
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Cần WEBHOOK_URL và WEBHOOK_SECRET trong Script Properties.');
  var last = sheet.getLastRow();
  var start = Math.max(2, firstRow);
  var end = Math.min(last, firstRow + count - 1);
  if (end < start) return;
  var values = sheet.getRange(start, 1, end - start + 1, Math.min(30, Math.max(16, sheet.getLastColumn()))).getDisplayValues();
  var rows = values.map(function(value, index) { return {rowNumber: start + index, values: value}; });
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {'X-Examination-Webhook-Secret': secret},
    payload: JSON.stringify({
      spreadsheetId: REGISTRATION_SPREADSHEET_ID,
      sheetTab: sheet.getName(),
      rows: rows
    }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('FT Workspace trả mã ' + response.getResponseCode() + ': ' + response.getContentText());
  }
  var result = JSON.parse(response.getContentText());
  if (result.errors && result.errors.length) {
    console.warn(sheet.getName() + ': ' + JSON.stringify(result.errors));
  }
}

function onRegistrationEdit(e) {
  if (!e || !e.range || !e.source || e.source.getId() !== REGISTRATION_SPREADSHEET_ID) return;
  sendRegistrationRows_(e.range.getSheet(), e.range.getRow(), e.range.getNumRows());
}

function onRegistrationFormSubmit(e) {
  if (!e || !e.range || !e.source || e.source.getId() !== REGISTRATION_SPREADSHEET_ID) return;
  sendRegistrationRows_(e.range.getSheet(), e.range.getRow(), 1);
}

function syncAllRegistrations() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== REGISTRATION_SPREADSHEET_ID) {
    throw new Error('Script phải được gắn với đúng Sheet đăng ký 2026–2027.');
  }
  REGISTRATION_TABS.forEach(function(name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) throw new Error('Thiếu tab ' + name);
    for (var row = 2; row <= sheet.getLastRow(); row += 150) {
      sendRegistrationRows_(sheet, row, Math.min(150, sheet.getLastRow() - row + 1));
    }
  });
}

/** Copy registrations entered on Workspace back to the original private Form tabs. */
function syncWorkspaceRegistrations() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== REGISTRATION_SPREADSHEET_ID) {
    throw new Error('Script phải được gắn với đúng Sheet đăng ký 2026–2027.');
  }
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Cần WEBHOOK_URL và WEBHOOK_SECRET trong Script Properties.');
  var base = url.replace(/\/webhook\/?$/, '');
  if (base === url) throw new Error('WEBHOOK_URL cần kết thúc bằng /webhook.');
  var options = {
    method: 'post', contentType: 'application/json',
    headers: {'X-Examination-Webhook-Secret': secret},
    payload: '{}', muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(base + '/workspace-pending', options);
  if (response.getResponseCode() !== 200) throw new Error('Không thể lấy đăng ký Workspace: ' + response.getResponseCode());
  var pending = JSON.parse(response.getContentText()).registrations || [];
  pending.forEach(function(item) {
    Object.keys(item.tabs || {}).forEach(function(tab) {
      if (REGISTRATION_TABS.indexOf(tab) < 0) throw new Error('Tab không hợp lệ: ' + tab);
      var sheet = book.getSheetByName(tab);
      if (!sheet) throw new Error('Thiếu tab ' + tab);
      if (sheet.getMaxColumns() < 18) sheet.insertColumnsAfter(sheet.getMaxColumns(), 18 - sheet.getMaxColumns());
      var header = String(sheet.getRange(1, 18).getDisplayValue() || '').trim();
      if (header && header !== 'Mã đăng ký Workspace') throw new Error('Cột R của ' + tab + ' đang được dùng.');
      if (!header) sheet.getRange(1, 18).setValue('Mã đăng ký Workspace');
      var marker = 'WORKSPACE:' + item.registrationId;
      var rowNumber = 0;
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var existing = sheet.getRange(2, 18, lastRow - 1, 1).getDisplayValues();
        for (var index = 0; index < existing.length; index++) {
          if (existing[index][0] === marker) { rowNumber = index + 2; break; }
        }
      }
      if (!rowNumber) {
        var values = item.tabs[tab];
        if (!Array.isArray(values) || values.length !== 18 || values[17] !== marker) throw new Error('Dòng đăng ký không hợp lệ.');
        sheet.appendRow(values);
        rowNumber = sheet.getLastRow();
      }
      var ack = UrlFetchApp.fetch(base + '/workspace-ack', {
        method: 'post', contentType: 'application/json',
        headers: {'X-Examination-Webhook-Secret': secret},
        payload: JSON.stringify({registrationId: item.registrationId, sheetTab: tab, rowNumber: rowNumber}),
        muteHttpExceptions: true
      });
      if (ack.getResponseCode() !== 200) throw new Error('Không thể xác nhận dòng Sheet: ' + ack.getResponseCode());
    });
  });
}

function installRegistrationTriggers() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== REGISTRATION_SPREADSHEET_ID) {
    throw new Error('Script phải được gắn với đúng Sheet đăng ký 2026–2027.');
  }
  var handlers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  if (handlers.indexOf('onRegistrationEdit') < 0) {
    ScriptApp.newTrigger('onRegistrationEdit').forSpreadsheet(book).onEdit().create();
  }
  if (handlers.indexOf('onRegistrationFormSubmit') < 0) {
    ScriptApp.newTrigger('onRegistrationFormSubmit').forSpreadsheet(book).onFormSubmit().create();
  }
  if (handlers.indexOf('syncAllRegistrations') < 0) {
    ScriptApp.newTrigger('syncAllRegistrations').timeBased().everyMinutes(10).create();
  }
  if (handlers.indexOf('syncWorkspaceRegistrations') < 0) {
    ScriptApp.newTrigger('syncWorkspaceRegistrations').timeBased().everyMinutes(10).create();
  }
}
