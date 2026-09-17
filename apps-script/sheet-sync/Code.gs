/**
 * Realtime Sheet -> Web sync trigger for "Lịch công tác FT 2026 mới"
 * (spreadsheet 1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc, tab "Lịch công tác").
 *
 * This file is kept in the FTWorkspace repo (apps-script/sheet-sync/Code.gs) so the logic is
 * reviewable and versioned, but the code that actually runs lives in the Sheet's own
 * Script Editor (Extensions -> Apps Script) — paste this file's contents there by hand,
 * there is no API access to deploy Apps Script projects from this repo.
 *
 * Companion backend endpoint: POST /api/work-schedule/sheet-webhook
 * (backend/work_schedule/views.py::work_schedule_sheet_webhook).
 *
 * One-time setup in the Script Editor:
 *   1. Project Settings -> Script Properties, add:
 *        WEBHOOK_URL    = https://<your-backend-host>/api/work-schedule/sheet-webhook
 *        WEBHOOK_SECRET = <same value as backend SHEET_WEBHOOK_SECRET>
 *   2. Triggers (clock icon in the left sidebar) -> Add Trigger:
 *        Function: onEditInstallable | Event source: From spreadsheet | Event type: On edit
 *   3. Add a second trigger:
 *        Function: onChangeInstallable | Event source: From spreadsheet | Event type: On change
 *      (an installable trigger, not the bare `onEdit(e)` simple trigger, because UrlFetchApp
 *      needs authorization that simple triggers are not allowed to request).
 */

var SHEET_NAME = 'Lịch công tác';
var OUTBOX_SHEET_NAME = '_SYNC_OUTBOX';
var FIRST_DATA_ROW = 3; // row 1 is the title and row 2 contains the column headers.

// Installable trigger entry point. Wire this up via Triggers -> Add Trigger -> On edit.
function onEditInstallable(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return; // ignore edits on Danh mục/Hướng dẫn/Quy trình/_SYNC_OUTBOX

  var firstRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  for (var offset = 0; offset < numRows; offset++) {
    var row = firstRow + offset;
    if (row < FIRST_DATA_ROW) continue; // skip header row edits
    handleRowEdit_(sheet, row, e);
  }
}

// Structural row operations do not emit row-level onEdit events. Reconcile the
// retained window after a real row insertion/deletion. Do not treat OTHER as a
// structural edit: Google emits it for unrelated changes and it caused needless
// full syncs while the backend was formatting or repairing rows.
function onChangeInstallable(e) {
  if (!e || !e.source) return;
  var sheet = e.source.getActiveSheet();
  if (!sheet || sheet.getName() !== SHEET_NAME) return;
  var changeType = String(e.changeType || 'OTHER');
  if (changeType === 'FORMAT') {
    // Formatting-only edits do not fire onEdit. Send the active rows so the
    // backend can persist the explicit bold/unbold choice for each task.
    var activeRange = sheet.getActiveRange();
    if (!activeRange) return;
    var firstRow = activeRange.getRow();
    var numRows = activeRange.getNumRows();
    for (var offset = 0; offset < numRows; offset++) {
      var row = firstRow + offset;
      if (row >= FIRST_DATA_ROW) handleRowEdit_(sheet, row, e);
    }
    return;
  }
  if (['INSERT_ROW', 'REMOVE_ROW'].indexOf(changeType) === -1) return;

  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var lastRun = Number(props.getProperty('LAST_STRUCTURAL_SYNC_AT') || 0);
  if (now - lastRun < 10000) return;
  props.setProperty('LAST_STRUCTURAL_SYNC_AT', String(now));

  var eventId = Utilities.getUuid();
  var payload = { event_type: 'full_sync', sheet_name: SHEET_NAME, reason: changeType };
  var outboxRow = appendToOutbox_(eventId, 1, payload);
  var result = sendFullSyncWebhook_(eventId, changeType);
  markOutboxResult_(outboxRow, result);
}

function handleRowEdit_(sheet, row, event) {
  // Keep the payload identical to the backend's Google Sheets read path
  // (valueRenderOption=FORMATTED_VALUE). getValues() turns date cells into
  // Date objects which JSON serializes as UTC and can shift the calendar day.
  // Read through the actual last header instead of assuming A:K. The visible
  // layout can gain columns (for example "Chấm công") while backend metadata
  // columns move to the right.
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var eventId = Utilities.getUuid();
  var payload = {
    row: row,
    values: values,
    edited_at: new Date().toISOString(),
    editor_email: currentEditorEmail_(event),
    sheet_name: SHEET_NAME,
  };
  var outboxRow = appendToOutbox_(eventId, row, payload);
  var result = sendWebhook_(eventId, row, payload);
  markOutboxResult_(outboxRow, result);
}

function appendToOutbox_(eventId, row, payload) {
  var outbox = ensureOutboxSheet_();
  var editedAt = payload && payload.edited_at ? payload.edited_at : new Date().toISOString();
  outbox.appendRow([
    eventId,
    row,
    editedAt,
    JSON.stringify(payload),
    'pending', // status: pending -> sent | error
    '', // response summary
    '', // processed_at
  ]);
  return outbox.getLastRow();
}

function currentEditorEmail_(event) {
  try {
    if (event && event.user && typeof event.user.getEmail === 'function') {
      var eventEmail = String(event.user.getEmail() || '').trim().toLowerCase();
      if (eventEmail) return eventEmail;
    }
  } catch (error) {
    // Some domains hide the event user's email from installable triggers.
  }
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (error) {
    return '';
  }
}

function markOutboxResult_(outboxRow, result) {
  var outbox = ensureOutboxSheet_();
  outbox.getRange(outboxRow, 5, 1, 3).setValues([[
    result.ok ? 'sent' : 'error',
    result.summary,
    new Date(),
  ]]);
}

function sendWebhook_(eventId, row, payload) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) {
    return { ok: false, summary: 'Thiếu WEBHOOK_URL/WEBHOOK_SECRET trong Script Properties.' };
  }
  var requestPayload = {
    event_id: eventId,
    row: row,
    values: Array.isArray(payload) ? payload : (payload && payload.values) || [],
  };
  if (payload && !Array.isArray(payload)) {
    if (payload.edited_at) requestPayload.edited_at = payload.edited_at;
    if (payload.editor_email) requestPayload.editor_email = payload.editor_email;
    if (payload.sheet_name) requestPayload.sheet_name = payload.sheet_name;
  }
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sheet-Webhook-Secret': secret },
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    if (code === 200) {
      return { ok: true, summary: 'HTTP 200: ' + body.substring(0, 300) };
    }
    return { ok: false, summary: 'HTTP ' + code + ': ' + body.substring(0, 300) };
  } catch (error) {
    return { ok: false, summary: 'Lỗi UrlFetchApp: ' + error };
  }
}

function sendFullSyncWebhook_(eventId, reason) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) {
    return { ok: false, summary: 'Thiếu WEBHOOK_URL/WEBHOOK_SECRET trong Script Properties.' };
  }
  var payload = {
    event_id: eventId,
    event_type: 'full_sync',
    sheet_name: SHEET_NAME,
    reason: reason || 'structural_change',
  };
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sheet-Webhook-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    return { ok: code === 200 || code === 202, summary: 'HTTP ' + code + ': ' + body.substring(0, 300) };
  } catch (error) {
    return { ok: false, summary: 'Lỗi UrlFetchApp: ' + error };
  }
}

function ensureOutboxSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var outbox = spreadsheet.getSheetByName(OUTBOX_SHEET_NAME);
  if (!outbox) {
    outbox = spreadsheet.insertSheet(OUTBOX_SHEET_NAME);
    outbox.appendRow(['event_id', 'row', 'edited_at', 'values_json', 'status', 'response', 'processed_at']);
    outbox.hideSheet();
  }
  return outbox;
}

// Compatibility no-op for the legacy time-driven trigger. The realtime
// onEdit/onChange triggers now own synchronization; keep the old trigger
// harmless until its owner removes it from the Apps Script project.
function watchdogSheetChanges() {}

/**
 * Manual retry helper: re-sends every outbox row still marked "error" or "pending".
 * Run this by hand from the Script Editor (Run -> retryFailedOutboxRows) after fixing
 * whatever caused the failures (e.g. backend was briefly down) — there is no automatic
 * retry loop, matching the brief's "chỉ đánh dấu đã xử lý sau khi backend trả 200".
 */
function retryFailedOutboxRows() {
  var outbox = ensureOutboxSheet_();
  var lastRow = outbox.getLastRow();
  if (lastRow < 2) return;
  var rows = outbox.getRange(2, 1, lastRow - 1, 7).getValues();
  for (var i = 0; i < rows.length; i++) {
    var status = rows[i][4];
    if (status === 'sent') continue;
    var eventId = rows[i][0];
    var row = rows[i][1];
    var payload = JSON.parse(rows[i][3]);
    var result = payload && payload.event_type === 'full_sync'
      ? sendFullSyncWebhook_(eventId, payload.reason)
      : sendWebhook_(eventId, row, payload);
    markOutboxResult_(i + 2, result);
  }
}
