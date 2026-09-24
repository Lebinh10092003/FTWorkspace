/**
 * Bound to "Khảo thí 2026-2027". Sends only a tab-change hint to FT Workspace.
 * The web server independently reads and compares the configured tab; no
 * candidate data is sent by this script and no import is done automatically.
 * Run installExaminationTriggers once to register both installable triggers.
 */
var EXAMINATION_SPREADSHEET_ID = '11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8';
var EXAMINATION_WEBHOOK_URL = 'https://workspace.fermat.vn/api/examination/sheets/change-webhook';
var EXAMINATION_TABS = [
  'SCO - SIAIO', 'SCO - SIBO', 'SCO - SIChO', 'SCO - SIPhO',
  'SCO - SILSO', 'FT - FIMO', 'FT - FIEO'
];

function onExaminationEdit(e) {
  if (!e || !e.range || !e.source) return;
  var tabName = e.range.getSheet().getName();
  if (EXAMINATION_TABS.indexOf(tabName) === -1) return;
  sendExaminationHint_(e.source.getId(), tabName);
}

function onExaminationChange(e) {
  if (!e || !e.source) return;
  // Cell edits already have a precise onEdit event. Formatting does not
  // change candidate data. Structural changes lack a reliable tab name.
  if (['EDIT', 'FORMAT'].indexOf(String(e.changeType || '')) !== -1) return;
  sendExaminationHint_(e.source.getId(), '*');
}

function sendExaminationHint_(spreadsheetId, tabName) {
  if (spreadsheetId !== EXAMINATION_SPREADSHEET_ID) return;
  Utilities.sleep(1200); // Give Google CSV export a moment to reflect the edit.
  var payload = JSON.stringify({spreadsheetId: spreadsheetId, sheetTab: tabName});
  for (var attempt = 0; attempt < 2; attempt++) {
    var response = UrlFetchApp.fetch(EXAMINATION_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code === 202) return; // Another trigger already requested this check.
    if (code === 200) {
      var result = JSON.parse(response.getContentText());
      if (result.changed || result.baselined || attempt === 1) return;
    } else if (attempt === 1) {
      throw new Error('FT Workspace webhook trả mã ' + code + ': ' + response.getContentText());
    }
    Utilities.sleep(3500);
  }
}

function installExaminationTriggers() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== EXAMINATION_SPREADSHEET_ID) {
    throw new Error('Dự án Apps Script chưa gắn với Sheet khảo thí 2026-2027.');
  }
  var existing = ScriptApp.getProjectTriggers().map(function(trigger) {
    return trigger.getHandlerFunction();
  });
  if (existing.indexOf('onExaminationEdit') === -1) {
    ScriptApp.newTrigger('onExaminationEdit').forSpreadsheet(spreadsheet).onEdit().create();
  }
  if (existing.indexOf('onExaminationChange') === -1) {
    ScriptApp.newTrigger('onExaminationChange').forSpreadsheet(spreadsheet).onChange().create();
  }
}

function testExaminationWebhook() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== EXAMINATION_SPREADSHEET_ID) {
    throw new Error('Dự án Apps Script chưa gắn với Sheet khảo thí 2026-2027.');
  }
  sendExaminationHint_(spreadsheet.getId(), 'SCO - SIAIO');
}
